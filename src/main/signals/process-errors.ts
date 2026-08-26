import { app } from 'electron';
import type { Logger } from '../../shared/logger';
import { toError } from '../../shared/serialize-error';
import type { BugSplatElectron } from '../client';
import type { MainProcessOptions } from '../options';
import { KeyedRateLimiter, TokenBucket } from '../rate-limit';

type Origin = 'main.uncaughtException' | 'main.unhandledRejection';

export interface ProcessLike {
    on(event: 'uncaughtException', listener: (error: Error) => void): unknown;
    on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
    off(event: 'uncaughtException', listener: (error: Error) => void): unknown;
    off(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

export interface AppExitLike {
    exit(code?: number): void;
}

/**
 * Hook main-process `uncaughtException` / `unhandledRejection`. Registering these listeners
 * replaces Electron's error dialog and Node's default "crash on unhandled rejection"; the
 * `exitOn*` options decide whether the app exits after the report is posted.
 */
export function installProcessErrorHandlers(
    client: BugSplatElectron,
    options: Required<MainProcessOptions>,
    logger: Logger,
    proc: ProcessLike = process,
    appRef: AppExitLike = app,
): () => void {
    const limiter = new KeyedRateLimiter(1, 1, new TokenBucket(20, 20 / 60));
    let exiting = false;

    const handle = (origin: Origin, value: unknown, exit: boolean): void => {
        try {
            if (exiting) {
                return;
            }
            const error = toError(value, `${origin} (electron main)`);
            logger.error(`${origin}:`, error);
            if (!limiter.take(origin)) {
                logger.warn(`dropping ${origin} report: rate limited`);
                if (exit) {
                    exiting = true;
                    appRef.exit(1);
                }
                return;
            }
            const posting = client.report({ kind: 'crash', origin, error }).catch(() => undefined);
            if (exit) {
                exiting = true;
                const timer = setTimeout(() => appRef.exit(1), options.exitTimeoutMs);
                timer.unref?.();
                void posting.finally(() => {
                    clearTimeout(timer);
                    appRef.exit(1);
                });
            }
        } catch (error) {
            logger.error(`failed to handle ${origin}`, error);
        }
    };

    const onUncaught = (error: Error): void =>
        handle('main.uncaughtException', error, options.exitOnUncaughtException);
    const onRejection = (reason: unknown): void =>
        handle('main.unhandledRejection', reason, options.exitOnUnhandledRejection);

    if (options.captureUncaughtExceptions) {
        proc.on('uncaughtException', onUncaught);
    }
    if (options.captureUnhandledRejections) {
        proc.on('unhandledRejection', onRejection);
    }
    return () => {
        proc.off('uncaughtException', onUncaught);
        proc.off('unhandledRejection', onRejection);
    };
}
