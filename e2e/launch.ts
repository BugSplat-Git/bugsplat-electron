import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const exampleMain = resolve(rootDir, 'example', 'dist', 'main.js');
export const exampleAddon = resolve(rootDir, 'example', 'dist', 'addon.node');
export const artifactsDir = resolve(rootDir, 'e2e', 'artifacts');
export const electronBinary: string = require('electron');
export const electronVersion: string = (require('electron/package.json') as { version: string })
    .version;
export const electronMajor = Number(electronVersion.split('.')[0]);

export interface LaunchOptions {
    scenario: string;
    submitUrl: string;
    jsUrl: string;
    extraEnv?: Record<string, string>;
    extraArgs?: string[];
}

export interface RunningApp {
    child: ChildProcess;
    exited: Promise<number | null>;
    output(): string;
    kill(): Promise<void>;
    save(name: string): void;
}

export function launchExample(options: LaunchOptions): RunningApp {
    const userData = mkdtempSync(join(tmpdir(), 'bugsplat-e2e-'));
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        BUGSPLAT_E2E: '1',
        BUGSPLAT_E2E_SUBMIT_URL: options.submitUrl,
        BUGSPLAT_CRASH_POST_URL: options.jsUrl,
        BUGSPLAT_FEEDBACK_POST_URL: options.jsUrl,
        BUGSPLAT_E2E_USER_DATA: userData,
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        ...options.extraEnv,
    };
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(
        electronBinary,
        [exampleMain, `--scenario=${options.scenario}`, ...(options.extraArgs ?? [])],
        { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const exited = new Promise<number | null>((resolveExit) => {
        child.on('exit', (code) => resolveExit(code));
        child.on('error', () => resolveExit(null));
    });

    return {
        child,
        exited,
        output: () => output,
        kill: async () => {
            if (child.exitCode !== null || child.signalCode !== null) {
                return;
            }
            child.kill();
            const timer = setTimeout(() => child.kill('SIGKILL'), 3_000);
            await exited;
            clearTimeout(timer);
        },
        save: (name) => {
            mkdirSync(artifactsDir, { recursive: true });
            const safeName = name.replace(/[^a-z0-9-]+/gi, '_');
            writeFileSync(join(artifactsDir, `${safeName}.log`), output);
        },
    };
}
