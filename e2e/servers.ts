/**
 * Zero-dependency capture servers standing in for BugSplat's endpoints:
 *  - 'crashpad': the Electron minidump endpoint (multipart, optionally gzip-encoded)
 *  - 'js':       the /post/js/ and /post/feedback/ JSON endpoints used by `bugsplat`
 */
import { EventEmitter } from 'node:events';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { gunzipSync } from 'node:zlib';

export interface CapturedFile {
    name: string;
    size: number;
    /** First bytes of the file (e.g. `MDMP` for minidumps). */
    magic: string;
    text?: string;
}

export interface CapturedRequest {
    fields: Record<string, string>;
    files: Record<string, CapturedFile>;
    headers: IncomingHttpHeaders;
    receivedAt: number;
    raw?: string;
}

export interface CaptureServer {
    url: string;
    requests: CapturedRequest[];
    /** Resolve with the first request matching `predicate` (already received or future). */
    waitFor(
        predicate?: (request: CapturedRequest) => boolean,
        timeoutMs?: number,
    ): Promise<CapturedRequest>;
    /** Assert that no matching request arrives within `quietMs`. */
    expectNone(predicate?: (request: CapturedRequest) => boolean, quietMs?: number): Promise<void>;
    close(): Promise<void>;
}

async function parseMultipart(
    body: Buffer,
    contentType: string,
): Promise<Pick<CapturedRequest, 'fields' | 'files' | 'raw'>> {
    const fields: Record<string, string> = {};
    const files: Record<string, CapturedFile> = {};
    if (!contentType.includes('multipart/form-data')) {
        return { fields, files, raw: body.toString('utf8') };
    }
    const form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
    for (const [name, value] of form.entries()) {
        if (typeof value === 'string') {
            fields[name] = value;
            continue;
        }
        const head = Buffer.from(await value.slice(0, 4).arrayBuffer()).toString('latin1');
        const file: CapturedFile = { name: value.name, size: value.size, magic: head };
        if (value.size < 64 * 1024 && !value.type.includes('octet')) {
            file.text = await value.text();
        }
        files[name] = file;
    }
    return { fields, files };
}

export function startCaptureServer(kind: 'crashpad' | 'js'): Promise<CaptureServer> {
    const emitter = new EventEmitter();
    const requests: CapturedRequest[] = [];
    const server: Server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            void (async () => {
                let body = Buffer.concat(chunks);
                const encoding = String(req.headers['content-encoding'] ?? '');
                if (encoding.includes('gzip')) {
                    body = gunzipSync(body);
                }
                let parsed: Pick<CapturedRequest, 'fields' | 'files' | 'raw'>;
                try {
                    parsed = await parseMultipart(body, String(req.headers['content-type'] ?? ''));
                } catch (error) {
                    parsed = { fields: {}, files: {}, raw: `parse error: ${String(error)}` };
                }
                const captured: CapturedRequest = {
                    ...parsed,
                    headers: req.headers,
                    receivedAt: Date.now(),
                };
                requests.push(captured);
                emitter.emit('request', captured);
                if (kind === 'crashpad') {
                    res.writeHead(200, { 'content-type': 'text/plain' });
                    res.end(`e2e-crash-${requests.length}`);
                } else {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(
                        JSON.stringify({
                            status: 'success',
                            current_server_time: Math.floor(Date.now() / 1000),
                            message: 'ok',
                            crash_id: requests.length,
                        }),
                    );
                }
            })();
        });
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            const url = `http://127.0.0.1:${port}/`;
            resolve({
                url,
                requests,
                waitFor: (predicate = () => true, timeoutMs = 60_000) =>
                    new Promise<CapturedRequest>((resolveRequest, reject) => {
                        const existing = requests.find(predicate);
                        if (existing) {
                            resolveRequest(existing);
                            return;
                        }
                        const timer = setTimeout(() => {
                            emitter.off('request', listener);
                            reject(
                                new Error(
                                    `timed out after ${timeoutMs}ms waiting for a ${kind} request (received ${requests.length})`,
                                ),
                            );
                        }, timeoutMs);
                        const listener = (request: CapturedRequest): void => {
                            if (predicate(request)) {
                                clearTimeout(timer);
                                emitter.off('request', listener);
                                resolveRequest(request);
                            }
                        };
                        emitter.on('request', listener);
                    }),
                expectNone: (predicate = () => true, quietMs = 3_000) =>
                    new Promise<void>((resolveNone, reject) => {
                        const check = (): void => {
                            const match = requests.find(predicate);
                            if (match) {
                                reject(
                                    new Error(
                                        `unexpected ${kind} request: ${JSON.stringify(match.fields)}`,
                                    ),
                                );
                            } else {
                                resolveNone();
                            }
                        };
                        setTimeout(check, quietMs);
                    }),
                close: () =>
                    new Promise<void>((resolveClose) => {
                        server.closeAllConnections?.();
                        server.close(() => resolveClose());
                    }),
            });
        });
    });
}
