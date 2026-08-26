import {
    BugSplat,
    type BugSplatAttachment,
    type BugSplatOptions,
    type BugSplatResponse,
} from 'bugsplat';
import type { IdentityPatch, IdentitySnapshot } from '../shared/identity';
import { createLogger, type Logger } from '../shared/logger';
import type {
    BugSplatBridge,
    PostRequest,
    RendererContext,
    ReportOrigin,
    SerializedAttachment,
    SerializedError,
    SerializedPostOptions,
} from '../shared/protocol';
import { serializeError, toError } from '../shared/serialize-error';
import { installCapture } from './capture';
import { locateBridge } from './bridge-locator';

export const SDK_VERSION: string = __SDK_VERSION__;

export type RendererMode = 'bridge' | 'ipc' | 'http';

export interface RendererInitOptions {
    /** Only used in HTTP mode (no preload bridge and no node integration). */
    database?: string;
    application?: string;
    version?: string;
    /** Override the main-process default for this renderer. */
    captureErrors?: boolean;
    captureUnhandledRejections?: boolean;
    /** Attributes to set (globally, through the main process) right after init. */
    attributes?: Record<string, string>;
    logger?: Logger | null;
}

export type { BugSplatBridge, IdentitySnapshot, IdentityPatch, BugSplatOptions, BugSplatResponse };

const CLIENT_KEY = '__bugsplatRendererClient';

async function serializeAttachments(
    attachments: BugSplatAttachment[] | undefined,
    logger: Logger,
): Promise<SerializedAttachment[]> {
    const result: SerializedAttachment[] = [];
    for (const attachment of attachments ?? []) {
        const { filename, data } = attachment;
        if (data instanceof Uint8Array) {
            result.push({ filename, data });
        } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
            result.push({ filename, data: new Uint8Array(await data.arrayBuffer()) });
        } else {
            logger.warn(`attachment "${filename}" has an unsupported data type and was skipped`);
        }
    }
    return result;
}

/**
 * Renderer client. Extends `bugsplat`'s `BugSplat` so it can be handed to `@bugsplat/react`'s
 * `ErrorBoundary` (`scope={{ getClient }}`); in bridge/ipc mode every post travels to the main
 * process over IPC and is sent from there with the shared identity.
 */
export class BugSplatRenderer extends BugSplat {
    readonly mode: RendererMode;
    readonly logger: Logger;
    private readonly bridge: BugSplatBridge | null;
    private identity: IdentitySnapshot | null;
    private readonly scope: Window;

    constructor(scope: Window, options: RendererInitOptions, logger: Logger) {
        const located = locateBridge(scope, SDK_VERSION, logger);
        const config = located.bridge?.getConfig() ?? null;
        super(
            config?.database ?? options.database ?? '',
            config?.application ?? options.application ?? '',
            config?.version ?? options.version ?? '',
        );
        this.scope = scope;
        this.logger = logger;
        this.mode = located.mode;
        this.bridge = located.bridge;
        this.identity = located.bridge?.getIdentity() ?? null;
        located.bridge?.onIdentity((snapshot) => {
            this.identity = snapshot;
        });
    }

    /** The last identity snapshot received from the main process (`null` in HTTP mode). */
    getIdentity(): Readonly<IdentitySnapshot> | null {
        return this.identity;
    }

    onIdentity(listener: (snapshot: IdentitySnapshot) => void): () => void {
        return this.bridge?.onIdentity(listener) ?? (() => undefined);
    }

    setAppKey(appKey: string): void {
        this.update({ appKey }, () => super.setDefaultAppKey(appKey));
    }

    setUser(user: string): void {
        this.update({ user }, () => super.setDefaultUser(user));
    }

    setEmail(email: string): void {
        this.update({ email }, () => super.setDefaultEmail(email));
    }

    setDescription(description: string): void {
        this.update({ description }, () => super.setDefaultDescription(description));
    }

    setNotes(notes: string): void {
        this.update({ notes }, () => undefined);
    }

    setAttribute(key: string, value: string): void {
        this.setAttributes({ [key]: value });
    }

    setAttributes(attributes: Record<string, string>): void {
        this.update({ attributes }, () => super.setDefaultAttributes(attributes));
    }

    removeAttribute(key: string): void {
        this.update({ attributes: { [key]: null } }, () => undefined);
    }

    override setDefaultAppKey(appKey: string): void {
        this.setAppKey(appKey);
    }

    override setDefaultUser(user: string): void {
        this.setUser(user);
    }

    override setDefaultEmail(email: string): void {
        this.setEmail(email);
    }

    override setDefaultDescription(description: string): void {
        this.setDescription(description);
    }

    override setDefaultAttributes(attributes: Record<string, string>): void {
        this.update({ attributes, replaceAttributes: true }, () =>
            super.setDefaultAttributes(attributes),
        );
    }

    /** Post an error. Never rejects. */
    override async post(
        error: Error | string,
        options?: BugSplatOptions,
    ): Promise<BugSplatResponse> {
        const original: Error | string = error;
        const location = this.href();
        return this.send(
            {
                kind: 'crash',
                origin: 'renderer.manual',
                error: serializeError(error, location),
                options: await this.serializeOptions(options),
                context: this.context(),
            },
            original,
            () => super.post(toError(error, location), options),
        );
    }

    override async postFeedback(
        title: string,
        options?: BugSplatOptions,
    ): Promise<BugSplatResponse> {
        return this.send(
            {
                kind: 'feedback',
                origin: 'renderer.feedback',
                title,
                options: await this.serializeOptions(options),
                context: this.context(),
            },
            title,
            () => super.postFeedback(title, options),
        );
    }

    /** @internal */
    async reportSerialized(
        error: SerializedError,
        origin: ReportOrigin,
    ): Promise<BugSplatResponse> {
        return this.send(
            { kind: 'crash', origin, error, context: this.context() },
            error.message,
            () => super.post(toError(error.message, this.href())),
        );
    }

    private context(): RendererContext {
        let visibilityState: string | undefined;
        try {
            visibilityState = this.scope.document.visibilityState;
        } catch {
            visibilityState = undefined;
        }
        return {
            href: this.href(),
            visibilityState,
            isTopLevel: this.scope.self === this.scope.top,
            capture: 'renderer',
        };
    }

    private href(): string {
        try {
            return this.scope.location.href;
        } catch {
            return '<renderer>';
        }
    }

    private async serializeOptions(options?: BugSplatOptions): Promise<SerializedPostOptions> {
        return {
            appKey: options?.appKey,
            user: options?.user,
            email: options?.email,
            description: options?.description,
            attributes: options?.attributes,
            attachments: await serializeAttachments(options?.attachments, this.logger),
        };
    }

    private update(patch: IdentityPatch, local: () => void): void {
        if (this.bridge) {
            void this.bridge.update(patch);
            return;
        }
        local();
    }

    private async send(
        request: PostRequest,
        original: Error | string,
        http: () => Promise<BugSplatResponse>,
    ): Promise<BugSplatResponse> {
        try {
            if (this.bridge) {
                const result = await this.bridge.post(request);
                return {
                    error: result.error ? new Error(`BugSplat Error: ${result.error}`) : null,
                    response: result.response,
                    original,
                } as BugSplatResponse;
            }
            if (!this.database) {
                return {
                    error: new Error(
                        'BugSplat Error: no bridge to the main process and no database configured for HTTP mode',
                    ),
                    response: null,
                    original,
                };
            }
            return await http();
        } catch (error) {
            return {
                error: new Error(
                    `BugSplat Error: ${error instanceof Error ? error.message : String(error)}`,
                ),
                response: null,
                original,
            };
        }
    }
}

function scopeOf(): Window | null {
    return typeof window === 'undefined' ? null : window;
}

/** Initialize BugSplat in this renderer. Idempotent; never throws. */
export function init(options: RendererInitOptions = {}): BugSplatRenderer {
    const scope = scopeOf();
    const logger = createLogger(options.logger, '[bugsplat renderer]');
    const existing = getClient();
    if (existing) {
        logger.warn(
            'init() was called more than once in this renderer; returning the existing client',
        );
        return existing;
    }
    if (!scope) {
        throw new Error('@bugsplat/electron/renderer requires a window');
    }
    const client = new BugSplatRenderer(scope, options, logger);
    (scope as unknown as Record<string, unknown>)[CLIENT_KEY] = client;

    const config = client.getIdentity()
        ? locateBridge(scope, SDK_VERSION).bridge?.getConfig()
        : null;
    const capture = {
        errors: options.captureErrors ?? config?.capture.errors ?? true,
        unhandledRejections:
            options.captureUnhandledRejections ?? config?.capture.unhandledRejections ?? true,
    };
    try {
        installCapture(scope, capture, (error, origin) => {
            void client.reportSerialized(error, origin);
        });
        const bridge = (scope as unknown as Record<string, unknown>)['__bugsplat'] as
            BugSplatBridge | undefined;
        bridge?.claim?.();
    } catch (error) {
        logger.error('failed to install error capture', error);
    }
    if (client.mode === 'http' && !client.database) {
        logger.warn(
            'no preload bridge was found and no database was given: reports cannot be sent from this renderer',
        );
    }
    if (options.attributes) {
        client.setAttributes(options.attributes);
    }
    return client;
}

/** The client created by `init()` in this renderer, or `null`. */
export function getClient(): BugSplatRenderer | null {
    const scope = scopeOf();
    if (!scope) {
        return null;
    }
    const client = (scope as unknown as Record<string, unknown>)[CLIENT_KEY];
    return client instanceof BugSplatRenderer ? client : null;
}

/** Post an error (initializes the renderer client on first use). */
export function post(error: Error | string, options?: BugSplatOptions): Promise<BugSplatResponse> {
    return (getClient() ?? init()).post(error, options);
}

export function setAttribute(key: string, value: string): void {
    (getClient() ?? init()).setAttribute(key, value);
}
