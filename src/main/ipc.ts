import type { BugSplatAttachment } from 'bugsplat';
import {
    BrowserWindow,
    ipcMain,
    webContents,
    type IpcMainEvent,
    type IpcMainInvokeEvent,
    type WebContents,
} from 'electron';
import type { IdentityPatch, IdentitySnapshot } from '../shared/identity';
import type { Logger } from '../shared/logger';
import {
    CHANNELS,
    LIMITS,
    PROTOCOL_VERSION,
    type BridgeConfig,
    type HelloRequest,
    type HelloResponse,
    type IdentityMessage,
    type PostRequest,
    type PostResult,
    type ReportOrigin,
    type SerializedError,
} from '../shared/protocol';
import { deserializeError } from '../shared/serialize-error';
import { truncateUtf8 } from '../shared/text';
import type { BugSplatElectron } from './client';
import type { ResolvedOptions, TrustSender } from './options';
import { KeyedRateLimiter } from './rate-limit';

const RENDERER_ORIGINS: ReadonlySet<ReportOrigin> = new Set<ReportOrigin>([
    'renderer.error',
    'renderer.unhandledrejection',
    'renderer.manual',
    'renderer.feedback',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, maxBytes: number): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    return truncateUtf8(value, maxBytes);
}

function sanitizeAttributes(value: unknown): Record<string, string> | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const result: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value).slice(0, LIMITS.maxAttributes)) {
        if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
            result[truncateUtf8(key, 256)] = truncateUtf8(String(raw), LIMITS.attributeValueBytes);
        }
    }
    return result;
}

function sanitizeAttachments(value: unknown): BugSplatAttachment[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const attachments: BugSplatAttachment[] = [];
    let total = 0;
    for (const item of value) {
        if (!isRecord(item) || typeof item.filename !== 'string') {
            continue;
        }
        let data: Uint8Array | undefined;
        if (item.data instanceof Uint8Array) {
            data = item.data;
        } else if (item.data instanceof ArrayBuffer) {
            data = new Uint8Array(item.data);
        }
        if (!data) {
            continue;
        }
        if (total + data.byteLength > LIMITS.attachmentBytes) {
            break;
        }
        total += data.byteLength;
        attachments.push({ filename: truncateUtf8(item.filename, 255), data });
    }
    return attachments;
}

function sanitizeSerializedError(value: unknown): SerializedError | null {
    if (!isRecord(value) || typeof value.message !== 'string') {
        return null;
    }
    const error: SerializedError = {
        name: optionalString(value.name, 256) || 'Error',
        message: truncateUtf8(value.message, LIMITS.messageBytes),
        stack: optionalString(value.stack, LIMITS.stackBytes) || `Error: ${value.message}`,
    };
    const cause = sanitizeSerializedError(value.cause);
    if (cause) {
        error.cause = cause;
    }
    return error;
}

/** Validate an untrusted `PostRequest` coming from a renderer. Returns `null` when malformed. */
export function validatePostRequest(raw: unknown): PostRequest | null {
    if (!isRecord(raw)) {
        return null;
    }
    const kind = raw.kind === 'feedback' ? 'feedback' : raw.kind === 'crash' ? 'crash' : null;
    if (!kind) {
        return null;
    }
    const origin = RENDERER_ORIGINS.has(raw.origin as ReportOrigin)
        ? (raw.origin as ReportOrigin)
        : kind === 'feedback'
          ? 'renderer.feedback'
          : 'renderer.manual';
    const error = sanitizeSerializedError(raw.error);
    const title = optionalString(raw.title, 1024);
    if (kind === 'crash' && !error) {
        return null;
    }
    if (kind === 'feedback' && !title) {
        return null;
    }
    const options = isRecord(raw.options) ? raw.options : {};
    const context = isRecord(raw.context) ? raw.context : {};
    return {
        kind,
        origin,
        error: error ?? undefined,
        title,
        options: {
            appKey: optionalString(options.appKey, 1024),
            user: optionalString(options.user, 1024),
            email: optionalString(options.email, 1024),
            description: optionalString(options.description, LIMITS.attributeValueBytes),
            attributes: sanitizeAttributes(options.attributes),
            attachments: sanitizeAttachments(options.attachments) as never,
        },
        context: {
            href: optionalString(context.href, 2048),
            visibilityState: optionalString(context.visibilityState, 32),
            isTopLevel: context.isTopLevel !== false,
            capture: context.capture === 'preload' ? 'preload' : 'renderer',
        },
    };
}

/** Validate an untrusted identity patch coming from a renderer. */
export function validateIdentityPatch(raw: unknown): IdentityPatch | null {
    if (!isRecord(raw)) {
        return null;
    }
    const patch: IdentityPatch = {};
    for (const field of ['appKey', 'user', 'email', 'description', 'notes'] as const) {
        const value = optionalString(raw[field], LIMITS.attributeValueBytes);
        if (value !== undefined) {
            patch[field] = value;
        }
    }
    if (isRecord(raw.attributes)) {
        const attributes: Record<string, string | null> = {};
        for (const [key, value] of Object.entries(raw.attributes).slice(0, LIMITS.maxAttributes)) {
            if (value === null) {
                attributes[key] = null;
            } else if (
                typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'boolean'
            ) {
                attributes[key] = truncateUtf8(String(value), LIMITS.attributeValueBytes);
            }
        }
        patch.attributes = attributes;
    }
    if (raw.replaceAttributes === true) {
        patch.replaceAttributes = true;
    }
    return patch;
}

/** Default trust policy: only top-level frames may post or change identity. */
export const trustTopLevelFrames: TrustSender = (event) => {
    const frame = event.senderFrame;
    if (!frame) {
        return false;
    }
    try {
        return frame.parent === null;
    } catch {
        return false;
    }
};

function safe<T>(fn: () => T): T | undefined {
    try {
        return fn();
    } catch {
        return undefined;
    }
}

/** Context attributes derived from the sending webContents (all `bugsplat.*`). */
export function senderContext(
    sender: WebContents | undefined,
    request: PostRequest,
    includeUrl: boolean,
): Record<string, string> {
    const attributes: Record<string, string> = {
        'bugsplat.processType': 'renderer',
        'bugsplat.capture': request.context.capture,
        'bugsplat.isTopLevel': String(request.context.isTopLevel),
    };
    if (request.context.visibilityState) {
        attributes['bugsplat.visibilityState'] = request.context.visibilityState;
    }
    if (includeUrl) {
        const url = request.context.href ?? safe(() => sender?.getURL());
        if (url) {
            attributes['bugsplat.url'] = url;
        }
    }
    if (!sender) {
        return attributes;
    }
    const title = safe(() => sender.getTitle());
    if (title) {
        attributes['bugsplat.title'] = truncateUtf8(title, 512);
    }
    const type = safe(() => sender.getType());
    if (type) {
        attributes['bugsplat.webContentsType'] = type;
    }
    attributes['bugsplat.webContentsId'] = String(sender.id);
    const pid = safe(() => sender.getOSProcessId());
    if (pid !== undefined) {
        attributes['bugsplat.pid'] = String(pid);
    }
    const visible = safe(() => BrowserWindow.fromWebContents(sender)?.isVisible());
    if (visible !== undefined) {
        attributes['bugsplat.visible'] = String(visible);
    }
    return attributes;
}

export interface IpcDeps {
    ipcMain: Pick<typeof ipcMain, 'on' | 'handle' | 'removeHandler' | 'removeListener'>;
    getAllWebContents: () => WebContents[];
}

const defaultDeps = (): IpcDeps => ({
    ipcMain,
    getAllWebContents: () => webContents.getAllWebContents(),
});

/** Broadcast an identity snapshot to every live webContents. */
export function broadcastIdentity(
    snapshot: IdentitySnapshot,
    contents: WebContents[],
    logger: Logger,
): void {
    const message: IdentityMessage = { identity: snapshot };
    for (const wc of contents) {
        try {
            if (wc.isDestroyed()) {
                continue;
            }
            wc.send(CHANNELS.identity, message);
        } catch (error) {
            logger.warn('failed to broadcast identity to a renderer', error);
        }
    }
}

export function buildBridgeConfig(options: ResolvedOptions, sdkVersion: string): BridgeConfig {
    return {
        database: options.database,
        application: options.application,
        version: options.version,
        sdkVersion,
        capture: {
            errors: options.renderer.captureErrors,
            unhandledRejections: options.renderer.captureUnhandledRejections,
            fallback: options.preload !== false && options.preload.fallbackCapture,
            includeUrl: options.renderer.includeUrl,
        },
    };
}

/** Install the main-process side of the preload/renderer protocol. Returns a disposer. */
export function installIpc(
    client: BugSplatElectron,
    logger: Logger,
    deps: IpcDeps = defaultDeps(),
): () => void {
    const options = client.resolvedOptions;
    const trust = options.trustSender ?? trustTopLevelFrames;
    const limiter = new KeyedRateLimiter(5, 1);
    const config = buildBridgeConfig(options, client.sdkVersion);

    const onHello = (event: IpcMainEvent, request: unknown): void => {
        try {
            const hello = request as HelloRequest | undefined;
            if (
                hello?.protocolVersion !== undefined &&
                hello.protocolVersion !== PROTOCOL_VERSION
            ) {
                logger.warn(
                    `renderer preload speaks protocol v${hello.protocolVersion} but main speaks v${PROTOCOL_VERSION}; update both @bugsplat/electron bundles`,
                );
            }
            const response: HelloResponse = {
                protocolVersion: PROTOCOL_VERSION,
                config,
                identity: client.store.get(),
            };
            event.returnValue = response;
        } catch (error) {
            logger.error('hello handler failed', error);
            event.returnValue = null;
        }
    };

    const onPost = async (event: IpcMainInvokeEvent, raw: unknown): Promise<PostResult> => {
        try {
            if (!trust(event)) {
                return { error: 'untrusted sender', response: null };
            }
            const request = validatePostRequest(raw);
            if (!request) {
                return { error: 'invalid request', response: null };
            }
            const senderId = String(safe(() => event.sender.id) ?? 'unknown');
            if (!limiter.take(senderId)) {
                return { error: 'rate limited', response: null };
            }
            const contextAttributes = senderContext(
                safe(() => event.sender),
                request,
                options.renderer.includeUrl,
            );
            const result = await client.report({
                kind: request.kind,
                origin: request.origin,
                error: request.error ? deserializeError(request.error) : undefined,
                title: request.title,
                options: request.options,
                contextAttributes,
                skipDefaultFiles: true,
            });
            return {
                error: result.error ? result.error.message : null,
                response: result.response ?? null,
            };
        } catch (error) {
            logger.error('post handler failed', error);
            return {
                error: error instanceof Error ? error.message : String(error),
                response: null,
            };
        }
    };

    const onUpdate = async (event: IpcMainInvokeEvent, raw: unknown): Promise<void> => {
        try {
            if (!trust(event)) {
                return;
            }
            const patch = validateIdentityPatch(raw);
            if (patch) {
                client.store.apply(patch);
            }
        } catch (error) {
            logger.error('identity update handler failed', error);
        }
    };

    deps.ipcMain.on(CHANNELS.hello, onHello);
    deps.ipcMain.handle(CHANNELS.post, onPost);
    deps.ipcMain.handle(CHANNELS.update, onUpdate);
    const unsubscribe = client.store.subscribe((snapshot) =>
        broadcastIdentity(snapshot, safe(deps.getAllWebContents) ?? [], logger),
    );

    return () => {
        unsubscribe();
        deps.ipcMain.removeListener(CHANNELS.hello, onHello);
        deps.ipcMain.removeHandler(CHANNELS.post);
        deps.ipcMain.removeHandler(CHANNELS.update);
    };
}
