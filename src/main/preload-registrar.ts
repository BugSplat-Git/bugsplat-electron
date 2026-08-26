import { app, session, type Session } from 'electron';
import { existsSync } from 'node:fs';
import type { Logger } from '../shared/logger';
import type { ResolvedPreloadOptions } from './options';
import { preloadPath } from './preload-path';

export const PRELOAD_ID = 'bugsplat';

export function resolvePreloadPath(override?: string): string {
    return override || preloadPath;
}

interface SessionLike {
    registerPreloadScript?: (script: { type: 'frame'; id?: string; filePath: string }) => string;
    getPreloadScripts?: () => Array<{ filePath: string }>;
    setPreloads?: (preloads: string[]) => void;
    getPreloads?: () => string[];
}

/** Register the preload into one session (idempotent). */
export function registerInto(ses: Session, filePath: string, logger: Logger): void {
    const target = ses as unknown as SessionLike;
    try {
        if (typeof target.registerPreloadScript === 'function') {
            const existing = target.getPreloadScripts?.() ?? [];
            if (existing.some((script) => script.filePath === filePath)) {
                return;
            }
            target.registerPreloadScript({ type: 'frame', id: PRELOAD_ID, filePath });
            return;
        }
        if (typeof target.setPreloads === 'function') {
            const current = target.getPreloads?.() ?? [];
            if (!current.includes(filePath)) {
                target.setPreloads([...current, filePath]);
            }
        }
    } catch (error) {
        logger.warn('failed to register the BugSplat preload in a session', error);
    }
}

export interface RegistrarDeps {
    app: Pick<typeof app, 'on' | 'removeListener' | 'whenReady' | 'isReady'>;
    defaultSession: () => Session;
    exists: (path: string) => boolean;
}

const defaultDeps = (): RegistrarDeps => ({
    app,
    defaultSession: () => session.defaultSession,
    exists: existsSync,
});

/**
 * Register the SDK preload into `session.defaultSession` and every session created later
 * (or into the given sessions). Returns a disposer.
 */
export function registerPreloadEverywhere(
    options: ResolvedPreloadOptions,
    logger: Logger,
    deps: RegistrarDeps = defaultDeps(),
): () => void {
    const filePath = resolvePreloadPath(options.path);
    if (!deps.exists(filePath)) {
        logger.warn(
            `preload not found at ${filePath}; renderer error reporting and identity sync are disabled. ` +
                'If your bundler inlines @bugsplat/electron, set preload.path, or import "@bugsplat/electron/preload" from your own preload and pass preload: { register: false }.',
        );
        return () => undefined;
    }

    const seen = new WeakSet<Session>();
    const register = (ses: Session): void => {
        if (seen.has(ses)) {
            return;
        }
        seen.add(ses);
        registerInto(ses, filePath, logger);
    };

    if (options.sessions !== 'all') {
        const sessions = options.sessions;
        void deps.app.whenReady().then(() => sessions.forEach(register));
        return () => undefined;
    }

    const onSessionCreated = (ses: Session): void => register(ses);
    deps.app.on('session-created', onSessionCreated);
    void deps.app.whenReady().then(() => {
        try {
            register(deps.defaultSession());
        } catch (error) {
            logger.warn('failed to access session.defaultSession', error);
        }
    });
    return () => {
        deps.app.removeListener('session-created', onSessionCreated);
    };
}
