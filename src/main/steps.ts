import { BrowserWindow } from 'electron';
import { enableJsCallStacks } from './features';
import type { InitStep } from './init';
import { installIpc } from './ipc';
import { registerPreloadEverywhere } from './preload-registrar';
import { installPreloadErrorCapture } from './signals/preload-error';
import { installProcessGone } from './signals/process-gone';
import { defaultTrackerDeps } from './signals/track-web-contents';
import { installDocumentPolicyInjection, installUnresponsive } from './signals/unresponsive';

/** Setup steps run by `init()` after the native reporter and main-process handlers. */
export function defaultSteps(): InitStep[] {
    return [
        {
            name: 'js call stacks feature',
            run: ({ options, logger }) => {
                if (options.unresponsive !== false && options.unresponsive.enableFeature) {
                    enableJsCallStacks(logger);
                }
            },
        },

        {
            name: 'preload registration',
            run: ({ options, logger }) => {
                if (options.preload !== false && options.preload.register) {
                    registerPreloadEverywhere(options.preload, logger);
                }
            },
        },

        {
            name: 'renderer ipc',
            run: ({ client, logger }) => {
                installIpc(client, logger);
            },
        },

        {
            name: 'process-gone reports',
            run: ({ client, options, logger }) => {
                installProcessGone(client, options.processGone, logger);
            },
        },

        {
            name: 'unresponsive reports',
            run: ({ client, options, logger }) => {
                if (options.unresponsive === false) {
                    return;
                }
                installUnresponsive(client, options.unresponsive, logger, {
                    ...defaultTrackerDeps(),
                    isVisible: (contents) => BrowserWindow.fromWebContents(contents)?.isVisible(),
                    now: () => Date.now(),
                });
                if (options.unresponsive.injectDocumentPolicyHeader) {
                    installDocumentPolicyInjection(logger);
                }
            },
        },

        {
            name: 'preload-error reports',
            run: ({ client, logger }) => {
                installPreloadErrorCapture(client, logger, defaultTrackerDeps());
            },
        },
    ];
}
