import type { WebContents } from 'electron';
import type { Logger } from '../../shared/logger';
import { toError } from '../../shared/serialize-error';
import type { BugSplatElectron } from '../client';
import { trackWebContents, type WebContentsTrackerDeps } from './track-web-contents';

function basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

/** Report errors thrown by preload scripts (`webContents` `preload-error`). */
export function installPreloadErrorCapture(
    client: BugSplatElectron,
    logger: Logger,
    deps?: WebContentsTrackerDeps,
): () => void {
    const track = (contents: WebContents): void => {
        contents.on('preload-error', (_event, preloadPath, error) => {
            try {
                let url: string | undefined;
                try {
                    url = contents.getURL();
                } catch {
                    url = undefined;
                }
                void client.report({
                    kind: 'crash',
                    origin: 'preload-error',
                    error: toError(error, `preload (${preloadPath})`),
                    contextAttributes: {
                        'bugsplat.processType': 'renderer',
                        'bugsplat.preloadPath': basename(String(preloadPath)),
                        ...(url ? { 'bugsplat.url': url } : {}),
                    },
                });
            } catch (handlerError) {
                logger.error('preload-error handler failed', handlerError);
            }
        });
    };
    return trackWebContents(track, deps);
}
