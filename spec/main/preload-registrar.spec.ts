import { EventEmitter } from 'node:events';
import { session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerInto, registerPreloadEverywhere } from '../../src/main/preload-registrar';
import type { Logger } from '../../src/shared/logger';

const logger = (): Logger => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
const FakeSession = (session as unknown as { FakeSession: new () => Electron.Session }).FakeSession;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deps(exists = true) {
    const app = Object.assign(new EventEmitter(), {
        whenReady: vi.fn(() => Promise.resolve()),
        isReady: vi.fn(() => false),
    });
    const defaultSession = new FakeSession();
    return {
        app: app as never,
        defaultSession: () => defaultSession,
        exists: () => exists,
        appRef: app,
        session: defaultSession,
    };
}

describe('registerPreloadEverywhere', () => {
    it('registers into the default session and sessions created later, once each', async () => {
        const d = deps();
        registerPreloadEverywhere(
            { register: true, sessions: 'all', fallbackCapture: true, path: '/p/preload.js' },
            logger(),
            d,
        );
        await flush();
        expect(d.session.registerPreloadScript).toHaveBeenCalledWith({
            type: 'frame',
            id: 'bugsplat',
            filePath: '/p/preload.js',
        });
        const later = new FakeSession();
        d.appRef.emit('session-created', later);
        d.appRef.emit('session-created', later);
        d.appRef.emit('session-created', d.session);
        expect(later.registerPreloadScript).toHaveBeenCalledTimes(1);
        expect(d.session.registerPreloadScript).toHaveBeenCalledTimes(1);
    });

    it('registers into explicit sessions only', async () => {
        const d = deps();
        const explicit = new FakeSession();
        registerPreloadEverywhere(
            { register: true, sessions: [explicit], fallbackCapture: true, path: '/p/preload.js' },
            logger(),
            d,
        );
        await flush();
        expect(explicit.registerPreloadScript).toHaveBeenCalledTimes(1);
        expect(d.session.registerPreloadScript).not.toHaveBeenCalled();
        expect(d.appRef.listenerCount('session-created')).toBe(0);
    });

    it('warns and skips when the preload file is missing', async () => {
        const d = deps(false);
        const log = logger();
        registerPreloadEverywhere(
            { register: true, sessions: 'all', fallbackCapture: true },
            log,
            d,
        );
        await flush();
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('preload not found'));
        expect(d.session.registerPreloadScript).not.toHaveBeenCalled();
    });
});

describe('registerInto', () => {
    it('is idempotent for already registered paths', () => {
        const ses = new FakeSession();
        registerInto(ses, '/p/preload.js', logger());
        registerInto(ses, '/p/preload.js', logger());
        expect(ses.registerPreloadScript).toHaveBeenCalledTimes(1);
    });

    it('falls back to setPreloads on older sessions', () => {
        const ses = { getPreloads: vi.fn(() => ['/app/preload.js']), setPreloads: vi.fn() };
        registerInto(ses as never, '/p/preload.js', logger());
        expect(ses.setPreloads).toHaveBeenCalledWith(['/app/preload.js', '/p/preload.js']);
    });

    it('never throws', () => {
        const ses = {
            registerPreloadScript: () => {
                throw new Error('boom');
            },
            getPreloadScripts: () => [],
        };
        const log = logger();
        expect(() => registerInto(ses as never, '/p', log)).not.toThrow();
        expect(log.warn).toHaveBeenCalled();
    });
});
