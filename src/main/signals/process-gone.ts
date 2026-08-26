import { BrowserWindow, app, type WebContents } from 'electron';
import type { Logger } from '../../shared/logger';
import type { BugSplatElectron } from '../client';
import type { GoneReason, ResolvedOptions } from '../options';
import { KeyedRateLimiter } from '../rate-limit';
import { describeWebContents } from './track-web-contents';

export interface RenderGoneDetails {
    reason: string;
    exitCode: number;
}

export interface ChildGoneDetails extends RenderGoneDetails {
    type: string;
    serviceName?: string;
    name?: string;
}

function goneError(name: string, message: string, reason: string, event: string): Error {
    const error = new Error(message);
    error.name = name;
    error.stack = `${name}: ${message}\n    at ${event}.${reason} (electron)`;
    return error;
}

export interface ProcessGoneDeps {
    app: Pick<typeof app, 'on' | 'removeListener'>;
    isVisible: (contents: WebContents) => boolean | undefined;
}

const defaultDeps = (): ProcessGoneDeps => ({
    app,
    isVisible: (contents) => BrowserWindow.fromWebContents(contents)?.isVisible(),
});

/**
 * Companion JS reports for `render-process-gone` / `child-process-gone`. By default only reasons
 * that never produce a minidump are reported, so native crashes are not double counted.
 */
export function installProcessGone(
    client: BugSplatElectron,
    options: ResolvedOptions['processGone'],
    logger: Logger,
    deps: ProcessGoneDeps = defaultDeps(),
): () => void {
    const limiter = new KeyedRateLimiter(5, 0.2);

    const shouldReport = (list: false | GoneReason[], reason: string): boolean =>
        list !== false && list.includes(reason as GoneReason) && limiter.take(reason);

    const onRenderGone = (
        _event: unknown,
        contents: WebContents,
        details: RenderGoneDetails,
    ): void => {
        try {
            if (!shouldReport(options.renderer, details.reason)) {
                return;
            }
            const context = describeWebContents(contents, deps.isVisible);
            const target = context['bugsplat.title'] || context['bugsplat.url'] || 'renderer';
            const message = `Renderer process gone: ${details.reason} (exit code ${details.exitCode}) — ${target}`;
            void client.report({
                kind: 'crash',
                origin: 'render-process-gone',
                error: goneError(
                    'RenderProcessGone',
                    message,
                    details.reason,
                    'render-process-gone',
                ),
                contextAttributes: {
                    'bugsplat.processType': 'renderer',
                    'bugsplat.reason': details.reason,
                    'bugsplat.exitCode': String(details.exitCode),
                    ...context,
                },
            });
        } catch (error) {
            logger.error('render-process-gone handler failed', error);
        }
    };

    const onChildGone = (_event: unknown, details: ChildGoneDetails): void => {
        try {
            if (!shouldReport(options.child, details.reason)) {
                return;
            }
            const suffix = details.serviceName || details.name;
            const message = `${details.type} process gone: ${details.reason} (exit code ${details.exitCode})${suffix ? ` — ${suffix}` : ''}`;
            const attributes: Record<string, string> = {
                'bugsplat.processType': details.type,
                'bugsplat.reason': details.reason,
                'bugsplat.exitCode': String(details.exitCode),
            };
            if (details.serviceName) {
                attributes['bugsplat.serviceName'] = details.serviceName;
            }
            if (details.name) {
                attributes['bugsplat.name'] = details.name;
            }
            void client.report({
                kind: 'crash',
                origin: 'child-process-gone',
                error: goneError('ChildProcessGone', message, details.reason, 'child-process-gone'),
                contextAttributes: attributes,
            });
        } catch (error) {
            logger.error('child-process-gone handler failed', error);
        }
    };

    deps.app.on('render-process-gone', onRenderGone as never);
    deps.app.on('child-process-gone', onChildGone as never);
    return () => {
        deps.app.removeListener('render-process-gone', onRenderGone as never);
        deps.app.removeListener('child-process-gone', onChildGone as never);
    };
}
