import type { BugSplat, BugSplatAttachment } from 'bugsplat';
import { app, net } from 'electron';
import { promises as fs } from 'node:fs';
import { basename } from 'node:path';
import type { Logger } from '../shared/logger';
import { LIMITS } from '../shared/protocol';
import type { FetchLike, TransportOption } from './options';

/** Resolve the `transport` option to a fetch implementation. */
export function createFetch(transport: TransportOption): FetchLike {
    if (typeof transport === 'function') {
        return transport;
    }
    const nodeFetch: FetchLike = (input, init) => globalThis.fetch(input, init);
    if (transport === 'node') {
        return nodeFetch;
    }
    return (input, init) => {
        if (app.isReady() && typeof net?.fetch === 'function') {
            const request = input instanceof URL ? input.href : input;
            return net.fetch(
                request as Parameters<typeof net.fetch>[0],
                init as Parameters<typeof net.fetch>[1],
            );
        }
        return nodeFetch(input, init);
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
