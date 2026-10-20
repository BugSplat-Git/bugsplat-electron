/**
 * Example Electron app integrated with @bugsplat/electron (migrated from my-electron-crasher).
 * One init() below wires native crash reporting, main-process JS errors, the renderer bridge,
 * hang and process-gone reports. Run `npm start` in example/ or `npm run e2e` at the repo root.
 */
import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { init, withJsCallStackPolicy } from '@bugsplat/electron';
import { isScenario, runScenario, type ScenarioContext } from './scenarios';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../package.json') as { name: string; version: string; database: string };

const args = process.argv.slice(1);
const scenarioArg = args.find((arg) => arg.startsWith('--scenario='))?.split('=')[1] ?? '';
const loadFile = args.includes('--load-file');
const e2e = process.env.BUGSPLAT_E2E === '1';

if (process.env.BUGSPLAT_E2E_USER_DATA) {
    app.setPath('userData', process.env.BUGSPLAT_E2E_USER_DATA);
}
if (scenarioArg === 'renderer-oom') {
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');
}

const log = (message: string): void => console.log(`[example] ${message}`);

// Call init() at the top level, before the app is ready.
const bugsplat = init({
    database: process.env.BUGSPLAT_DATABASE || pkg.database,
    application: pkg.name,
    version: pkg.version,
    appKey: process.env.BUGSPLAT_E2E_APP_KEY || 'example-key',
    user: 'Fred',
    email: 'fred@bugsplat.com',
    description: 'BugSplat example app',
    attributes: { channel: e2e ? 'e2e' : 'example' },
    additionalFilePaths: [path.join(__dirname, 'assets', 'attachment.txt')],
    native: {
        submitURL: process.env.BUGSPLAT_E2E_SUBMIT_URL || undefined,
    },
    main: {
        // In e2e mode the harness waits for the app to exit after an uncaught error.
        exitOnUncaughtException: e2e,
        exitOnUnhandledRejection: e2e,
    },
    transport: process.env.BUGSPLAT_E2E_TRANSPORT === 'net' ? 'net' : 'node',
});

// Serve the UI from a custom scheme so responses can carry the Document-Policy header that
// unlocks JS call stacks for hung renderers (file:// pages cannot opt in).
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
};

function serveApp(): void {
    protocol.handle('app', async (request) => {
        const url = new URL(request.url);
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/' || pathname === '') {
            pathname = '/index.html';
        }
        // Resolve inside __dirname and reject anything that climbs out of it. A string prefix
        // check would also accept a sibling such as `${__dirname}-other`.
        const filePath = path.resolve(__dirname, `.${pathname}`);
        const relative = path.relative(__dirname, filePath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return new Response('Forbidden', { status: 403 });
        }
        const response = await net.fetch(pathToFileURL(filePath).toString());
        if (!response.ok) {
            return new Response('Not found', { status: 404 });
        }
        const headers = withJsCallStackPolicy({
            'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
        });
        return new Response(response.body, { status: 200, headers });
    });
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: 980,
        height: 760,
        show: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
        },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: 'deny' };
    });
    if (loadFile) {
        void window.loadFile(path.join(__dirname, 'index.html'));
    } else {
        void window.loadURL('app://bundle/index.html');
    }
    window.on('closed', () => {
        mainWindow = null;
    });
    return window;
}

const context = (): ScenarioContext => ({
    bugsplat,
    window: mainWindow,
    distDir: __dirname,
    log,
});

ipcMain.handle('demo:run', async (_event, name: unknown) => {
    if (typeof name !== 'string' || !isScenario(name)) {
        return `unknown scenario: ${String(name)}`;
    }
    return runScenario(name, context());
});

app.whenReady().then(() => {
    serveApp();
    mainWindow = createWindow();
    log(
        `Electron ${process.versions.electron}, native reporting ${bugsplat.nativeStarted ? 'on' : 'off'}`,
    );

    if (scenarioArg) {
        mainWindow.webContents.once('did-finish-load', () => {
            setTimeout(() => {
                if (!isScenario(scenarioArg)) {
                    log(`unknown scenario ${scenarioArg}`);
                    app.exit(2);
                    return;
                }
                void runScenario(scenarioArg, context()).then(log);
            }, 500);
        });
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow = createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || e2e) {
        app.quit();
    }
});
