/** Minimal logger surface used for the SDK's own diagnostics. */
export interface Logger {
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

export const LOG_PREFIX = '[bugsplat]';

const silent: Logger = {
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

/**
 * Wrap a logger (default: console) with the SDK prefix. `null` silences everything.
 */
export function createLogger(base: Logger | null | undefined, prefix: string = LOG_PREFIX): Logger {
    if (base === null) {
        return silent;
    }
    const target: Logger = base ?? console;
    return {
        log: (...args) => target.log(prefix, ...args),
        warn: (...args) => target.warn(prefix, ...args),
        error: (...args) => target.error(prefix, ...args),
    };
}

/** Logger decorator that emits each keyed warning only once. */
export class OnceLogger {
    private readonly seen = new Set<string>();

    constructor(private readonly logger: Logger) {}

    warnOnce(key: string, ...args: unknown[]): void {
        if (this.seen.has(key)) {
            return;
        }
        this.seen.add(key);
        this.logger.warn(...args);
    }
}
