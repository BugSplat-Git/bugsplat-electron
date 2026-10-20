import type { BugSplat, BugSplatAttachment } from 'bugsplat';
import { app, net, session, type Session } from 'electron';
import { promises as fs } from 'node:fs';
import { basename } from 'node:path';
import type { Logger } from '../shared/logger';
import { LIMITS } from '../shared/protocol';
import type { FetchLike, TransportOption } from './options';

/**
 * The in-memory session `transport: 'net'` posts from. Requests from `session.defaultSession`
 * wait for its on-disk cookie store to load, and on a cold start that can outlast the exit
 * timeout after an uncaught exception, so the report never leaves. An in-memory partition has
 * nothing to load and never attaches the app's own cookies to a report. Proxy, PAC and
 * certificate settings still come from the system, as they do for the default session.
 */
export const NET_TRANSPORT_PARTITION = 'bugsplat-transport';

/** Resolve the `transport` option to a fetch implementation. */
export function createFetch(transport: TransportOption): FetchLike {
    if (typeof transport === 'function') {
        return transport;
    }
    const nodeFetch: FetchLike = (input, init) => globalThis.fetch(input, init);
    if (transport === 'node') {
        return nodeFetch;
    }
    let transportSession: Session | undefined;
    return (input, init) => {
        if (!app.isReady()) {
            return nodeFetch(input, init);
        }
        transportSession ??= session.fromPartition(NET_TRANSPORT_PARTITION, { cache: false });
        const request = (input instanceof URL ? input.href : input) as Parameters<
            typeof net.fetch
        >[0];
        const options = init as Parameters<typeof net.fetch>[1];
        if (typeof transportSession.fetch === 'function') {
            return transportSession.fetch(request, options);
        }
        return net.fetch(request, options);
    };
}

/**
 * `bugsplat@^9.1` keeps its fetch in a private `_fetch` field that is assignable at runtime
 * (the sanctioned injection seam used by its own tests and by React Native).
 */
export function injectFetch(client: BugSplat, fetchImpl: FetchLike): void {
    (client as unknown as { _fetch: FetchLike })._fetch = fetchImpl;
}

/**
 * Read files into attachments for JS reports. Missing files are skipped with a warning and
 * files beyond the cumulative size cap are dropped. Never throws.
 */
export async function readFileAttachments(
    paths: readonly string[],
    logger: Logger,
    maxBytes: number = LIMITS.attachmentBytes,
): Promise<BugSplatAttachment[]> {
    const attachments: BugSplatAttachment[] = [];
    let total = 0;
    for (const filePath of paths) {
        try {
            const data = await fs.readFile(filePath);
            if (total + data.byteLength > maxBytes) {
                logger.warn(
                    `attachment limit of ${maxBytes} bytes exceeded, skipping file: ${filePath}`,
                );
                continue;
            }
            total += data.byteLength;
            attachments.push({ filename: basename(filePath), data: new Uint8Array(data) });
        } catch {
            logger.warn(`attachment does not exist or is unreadable, skipping file: ${filePath}`);
        }
    }
    return attachments;
}
