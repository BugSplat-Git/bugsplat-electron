import { vi } from 'vitest';
import { BugSplatElectron } from '../../src/main/client';
import { IdentityStore } from '../../src/main/identity-store';
import { resolveOptions, type BugSplatElectronOptions } from '../../src/main/options';
import { detectCapabilities } from '../../src/main/capabilities';
import { createLogger, type Logger } from '../../src/shared/logger';

export function okResponse(body: Record<string, unknown> = {}): Response {
    return new Response(
        JSON.stringify({
            status: 'success',
            current_server_time: 1,
            message: 'ok',
            crash_id: 42,
            ...body,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

export function createTestClient(
    overrides: Partial<BugSplatElectronOptions> = {},
    fetchImpl?: (input: unknown, init?: RequestInit) => Promise<Response>,
) {
    const warnings: unknown[][] = [];
    const logger: Logger = {
        log: vi.fn(),
        warn: vi.fn((...args: unknown[]) => warnings.push(args)),
        error: vi.fn(),
    };
    const options = resolveOptions(
        { database: 'fred', application: 'app', version: '1.0.0', ...overrides },
        { appName: 'default-app', appVersion: '0.0.1' },
    );
    const store = new IdentityStore(options.initialIdentity, logger);
    const fetchSpy = vi.fn(fetchImpl ?? (async () => okResponse()));
    const client = new BugSplatElectron({
        options,
        store,
        logger: createLogger(logger),
        capabilities: detectCapabilities('44.0.0', true),
        sdkVersion: '0.0.0-test',
        fetchImpl: fetchSpy as unknown as typeof fetch,
        crash: vi.fn(),
    });
    const lastBody = (): FormData => {
        const call = fetchSpy.mock.calls.at(-1) as unknown as [unknown, RequestInit];
        return call[1].body as FormData;
    };
    const lastUrl = (): string => String((fetchSpy.mock.calls.at(-1) as unknown[])[0]);
    return { client, store, fetchSpy, logger, warnings, lastBody, lastUrl, options };
}

/** One entry of the `exceptions` chain `bugsplat` posts: the error itself first, linked errors after. */
export interface PostedException {
    id: number;
    parentId: number | null;
    source: string | null;
    type: string;
    message: string;
    stack?: string;
    properties: Record<string, unknown>;
}

export function postedExceptions(body: FormData): PostedException[] {
    return (JSON.parse(String(body.get('exceptions'))) as { exceptions: PostedException[] })
        .exceptions;
}
