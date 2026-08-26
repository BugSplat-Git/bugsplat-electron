/**
 * Every demo scenario, shared by the UI buttons and the `--scenario=<name>` CLI used by e2e.
 * Main-process scenarios run here; renderer scenarios are forwarded to the page.
 */
import { app, utilityProcess, type BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { BugSplatElectron } from '@bugsplat/electron';
import { uncaughtException, unhandledRejection } from './crasher';

export const MAIN_SCENARIOS = [
    'main-throw',
    'main-reject',
    'main-post',
    'main-crash',
    'utility-crash',
    'addon-crash',
] as const;

export const RENDERER_SCENARIOS = [
    'renderer-throw',
    'renderer-reject',
    'renderer-post',
    'renderer-feedback',
    'renderer-crash',
    'renderer-hang',
    'renderer-hang-native',
    'renderer-oom',
    'identity-from-page',
] as const;

export type ScenarioName = (typeof MAIN_SCENARIOS)[number] | (typeof RENDERER_SCENARIOS)[number];

export function isScenario(name: string): name is ScenarioName {
    return (
        (MAIN_SCENARIOS as readonly string[]).includes(name) ||
        (RENDERER_SCENARIOS as readonly string[]).includes(name)
    );
}

export interface ScenarioContext {
    bugsplat: BugSplatElectron;
    window: BrowserWindow | null;
    distDir: string;
    log: (message: string) => void;
}

export async function runScenario(name: ScenarioName, ctx: ScenarioContext): Promise<string> {
    ctx.log(`running scenario: ${name}`);
    switch (name) {
        case 'main-throw':
            setTimeout(() => uncaughtException('main-throw'), 10);
            return 'throwing in the main process';
        case 'main-reject':
            void unhandledRejection('main-reject');
            return 'rejecting a promise in the main process';
        case 'main-post': {
            const result = await ctx.bugsplat.post(new Error('BugSplat: manual post from main'), {
                attributes: { manual: 'true' },
            });
            return result.error ? `post failed: ${result.error.message}` : 'posted from main';
        }
        case 'main-crash':
            setTimeout(() => process.crash(), 10);
            return 'crashing the main process natively';
        case 'utility-crash': {
            const child = utilityProcess.fork(path.join(ctx.distDir, 'utility-crasher.js'), [], {
                serviceName: 'bugsplat-example-utility',
            });
            child.on('exit', (code) => ctx.log(`utility process exited with ${code}`));
            return 'forked a utility process that crashes natively';
        }
        case 'addon-crash': {
            const addonPath = path.join(ctx.distDir, 'addon.node');
            if (!existsSync(addonPath)) {
                return 'native addon not built (run `npm run build:addon` in example/)';
            }
            // The addon's add() dereferences a null pointer on purpose.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const addon = require(addonPath) as { add: (x: number, y: number) => number };
            setTimeout(() => addon.add(1, 2), 10);
            return 'crashing inside the native addon';
        }
        default: {
            if (!ctx.window || ctx.window.isDestroyed()) {
                return 'no window to run the renderer scenario in';
            }
            ctx.window.webContents.send('demo:scenario', name);
            if (name === 'renderer-hang' || name === 'renderer-hang-native') {
                armHangMonitor(ctx.window);
            }
            return `forwarded ${name} to the renderer`;
        }
    }
}

/**
 * Chromium reports a renderer as unresponsive only when it stops acknowledging input, so a
 * spinning renderer with no input never fires `unresponsive`. Keep poking it with mouse moves.
 */
function armHangMonitor(window: BrowserWindow): void {
    // Chromium only runs the hung-renderer monitor for visible widgets: make sure the window
    // is on screen (an app launched from a test runner can end up behind other windows).
    try {
        window.setAlwaysOnTop(true);
        window.show();
        window.moveTop();
        window.focus();
    } catch {
        // best effort
    }
    window.webContents.once('unresponsive', () => console.log('[example] renderer unresponsive'));
    const timer = setInterval(() => {
        if (window.isDestroyed() || window.webContents.isDestroyed()) {
            clearInterval(timer);
            return;
        }
        try {
            window.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 });
        } catch (error) {
            console.log('[example] sendInputEvent failed', error);
            clearInterval(timer);
        }
    }, 500);
    window.webContents.once('responsive', () => clearInterval(timer));
    window.webContents.once('destroyed', () => clearInterval(timer));
    app.once('before-quit', () => clearInterval(timer));
}
