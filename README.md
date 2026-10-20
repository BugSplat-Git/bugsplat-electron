[![bugsplat-github-banner-basic-outline](https://user-images.githubusercontent.com/20464226/149019306-3186103c-5315-4dad-a499-4fd1df408475.png)](https://bugsplat.com)
<br/>

# <div align="center">BugSplat</div>

### **<div align="center">Crash and error reporting built for busy developers.</div>**

<div align="center">
    <a href="https://bsky.app/profile/bugsplatco.bsky.social"><img alt="Follow BugSplat on Bluesky" src="https://img.shields.io/badge/Follow%20BugSplat-Bluesky-blue?logo=bluesky&style=social"></a>
    <a href="https://discord.gg/K4KjjRV5ve"><img alt="Join BugSplat on Discord" src="https://img.shields.io/discord/664965194799251487?label=Join%20Discord&logo=Discord&style=social"></a>
    <br/>
    <a href="https://www.npmjs.com/package/@bugsplat/electron"><img alt="@bugsplat/electron on npm" src="https://img.shields.io/npm/v/@bugsplat/electron?label=npm&logo=npm"></a>
</div>

## Introduction

`@bugsplat/electron` is BugSplat's crash and error reporting SDK for Electron. One `init()` in the main process gives you:

- **Native crashes** in every process (main, renderers, GPU, utility, native addons) as Crashpad minidumps, symbolicated by BugSplat.
- **JavaScript errors** in the main process (`uncaughtException`, `unhandledRejection`) and in every renderer (`error`, `unhandledrejection`) — renderer reports travel to the main process over IPC, so no Content Security Policy changes are needed.
- **Renderer hangs** with the JavaScript call stack that was running when the page stopped responding.
- **Out-of-memory crashes** with the JavaScript stack, heap statistics and OOM location as searchable attributes (Electron 42.10.1+).
- **One identity everywhere**: the user, email, application key, description and attributes you set in main or in a renderer are applied to native crash keys in every process, to main-process reports and to renderer reports.

Supported: Electron 35 and later (OOM crash keys need 42.10.1+). Before you start, [sign up](https://app.bugsplat.com/v2/sign-up) for BugSplat and create a database. The [example app](example/) in this repo demonstrates every feature.

## Installation

```sh
npm i @bugsplat/electron
```

`bugsplat` is a peer dependency and is installed automatically by npm 7+. Add your BugSplat database to `package.json` so both the SDK and [`@bugsplat/symbol-upload`](https://github.com/BugSplat-Git/symbol-upload) can read it:

```json
{
    "name": "my-electron-app",
    "version": "1.0.0",
    "database": "fred"
}
```

## Quick start

**Main process** — call `init()` at the top level of your main script, before `app.whenReady()`:

```ts
import { init } from '@bugsplat/electron';

const { database, name, version } = require('./package.json');

const bugsplat = init({ database, application: name, version });

bugsplat.setUser('Fred');
bugsplat.setEmail('fred@bedrock.com');
bugsplat.setAttribute('plan', 'pro');
```

**Renderer** — one line in your page or bundle:

```ts
import { init } from '@bugsplat/electron/renderer';

init();
```

No bundler in the renderer? Load the global build instead:

```html
<script src="./vendor/renderer.global.js"></script>
<script>
    BugSplatElectron.init();
</script>
```

(`node_modules/@bugsplat/electron/dist/renderer.global.js` — copy it next to your page at build time.)

That's it. Throw an error in either process, or call `process.crash()`, and the report shows up on the [Crashes](https://app.bugsplat.com/v2/crashes) page a few seconds later.

## Configuration

`init()` accepts the following options. Everything but `database` is optional.

| Option                | Type                           | Default               | Description                                                                                                    |
| --------------------- | ------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `database`            | `string`                       | —                     | Your BugSplat database. Without it reporting is disabled (with a warning).                                     |
| `application`         | `string`                       | `app.name`            | Application name (`product` on native reports, `appName` on JS reports).                                       |
| `version`             | `string`                       | `app.getVersion()`    | Application version.                                                                                           |
| `appKey`              | `string`                       |                       | Application key (`key` on native reports).                                                                     |
| `user`, `email`       | `string`                       |                       | User identity. `email` is what BugSplat's Electron endpoint reads today; `user` is searchable as an attribute. |
| `description`         | `string`                       |                       | Description (`comments` on native reports).                                                                    |
| `notes`               | `string`                       |                       | Notes (`notes` on native reports, `notes` attribute on JS reports).                                            |
| `attributes`          | `Record<string, string>`       | `{}`                  | Searchable key/value attributes, applied to native crash keys and JS reports.                                  |
| `additionalFilePaths` | `string[]`                     | `[]`                  | Files attached to main-process JS reports (10 MB total).                                                       |
| `native`              | `false \| NativeOptions`       | see below             | `crashReporter.start()` options. `false` disables native reporting.                                            |
| `preload`             | `false \| PreloadOptions`      | `{ register: true }`  | Automatic preload registration (see [Renderer setup](#renderer-setup)).                                        |
| `main`                | `MainProcessOptions`           | see below             | Main-process JS error handling.                                                                                |
| `renderer`            | `RendererCaptureOptions`       | capture everything    | Defaults pushed to every renderer (`captureErrors`, `captureUnhandledRejections`, `includeUrl`).               |
| `processGone`         | `ProcessGoneOptions`           | minidump-less reasons | Companion JS reports for `render-process-gone` / `child-process-gone` (see [How it works](#how-it-works)).     |
| `unresponsive`        | `false \| UnresponsiveOptions` | see below             | Renderer hang reports.                                                                                         |
| `transport`           | `'node' \| 'net' \| fetch`     | `'node'`              | `'net'` sends JS reports through Electron's `net.fetch` (system proxy, PAC and enterprise certificates).       |
| `beforePost`          | `(report) => report \| null`   |                       | Inspect, modify or drop (`null`) every report before it is sent.                                               |
| `trustSender`         | `(event) => boolean`           | top-level frames only | Which renderer frames may post reports or change identity.                                                     |
| `logger`              | `Logger \| null`               | `console`             | SDK diagnostics. `null` silences them.                                                                         |

`native`: `submitURL` (default `https://{database}.bugsplat.com/post/electron/v2/crash.php`), `productName`, `uploadToServer` (`true`), `ignoreSystemCrashHandler` (`true`), `rateLimit` (`false`), `compress` (`true`), `extra` (main-process crash keys), `globalExtra` (crash keys sent with every process; they cannot change after startup, so identity fields are rejected here).

`main`: `captureUncaughtExceptions` (`true`), `captureUnhandledRejections` (`true`), `exitOnUncaughtException` (`false`), `exitOnUnhandledRejection` (`false`), `exitTimeoutMs` (`5000`). Note that installing these handlers replaces Electron's "A JavaScript error occurred in the main process" dialog; set `exitOnUncaughtException: true` if you prefer to quit after reporting.

`unresponsive`: `collectStack` (`true`), `stackTimeoutMs` (`3000`), `enableFeature` (`true`, adds `DocumentPolicyIncludeJSCallStacksInCrashReports` to `--enable-features`), `injectDocumentPolicyHeader` (`false`), `reportWithoutStack` (`true`).

The client returned by `init()` (also available through `getClient()`):

```ts
bugsplat.setAppKey(key); bugsplat.setUser(user); bugsplat.setEmail(email);
bugsplat.setDescription(text); bugsplat.setNotes(text);
bugsplat.setAttribute(key, value); bugsplat.setAttributes({ ... }); bugsplat.removeAttribute(key);
bugsplat.getIdentity();                       // current snapshot
await bugsplat.post(error, options);          // never rejects; resolves { error, response, original }
await bugsplat.postFeedback(title, options);  // user feedback
bugsplat.crash();                             // process.crash(), for testing
```

The renderer client (`init()` / `getClient()` from `@bugsplat/electron/renderer`) has the same setters, `post()` and `postFeedback()`, plus `mode` (`'bridge'`, `'ipc'` or `'http'`) and `getIdentity()`.

## How it works

| Failure                                                                                                | Captured by                                                                | Arrives at BugSplat as                                             |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Native crash (main, renderer, GPU, utility, `.node` addon)                                             | Electron `crashReporter` (Crashpad)                                        | Minidump with native call stacks and your crash keys as attributes |
| JS error in main                                                                                       | `process.on('uncaughtException' / 'unhandledRejection')`                   | JavaScript report with the JS call stack                           |
| JS error in a renderer                                                                                 | `window` `error` / `unhandledrejection` → preload bridge → IPC → main      | JavaScript report with the renderer call stack, URL and title      |
| Renderer hang                                                                                          | `webContents` `unresponsive` + `WebFrameMain.collectJavaScriptCallStack()` | `RendererUnresponsive` report grouped by the hung JS frame         |
| Renderer out of memory                                                                                 | Electron ≥ 42.10.1 writes `electron.v8-oom.*` crash keys                   | Minidump with `electron.v8-oom.stack`, heap statistics, location   |
| Renderer/child process gone without a minidump (`abnormal-exit`, `launch-failed`, `integrity-failure`) | `app` `render-process-gone` / `child-process-gone`                         | `RenderProcessGone` / `ChildProcessGone` report grouped by reason  |
| Error in a preload script                                                                              | `webContents` `preload-error`                                              | JavaScript report                                                  |

**About mixed-mode stacks.** A native crash report contains native frames from the minidump; JavaScript frames come from the OOM and hang mechanisms above or from JavaScript reports. Electron does not provide a single interleaved native+JavaScript stack, so a crash inside a native addon shows the native stack only. If you need the JS side of a native crash, add context with `setAttribute()` before calling into native code.

`crashed` and `oom` renderer exits already produce a minidump, so they don't create a second JavaScript report by default; `processGone: { renderer: 'all' }` changes that. `killed`, `memory-eviction` and `clean-exit` are never reported unless listed explicitly.

## Identity and attributes

`setUser`, `setEmail`, `setAppKey`, `setDescription`, `setNotes` and `setAttribute` can be called from the main process or from any renderer. Every change is applied to:

1. the main-process JavaScript client,
2. `crashReporter.addExtraParameter()` in the main process **and in every renderer** (Crashpad crash keys are per process), and
3. every renderer's JavaScript client.

Crashpad limits crash key names to 39 bytes and values to 20,320 bytes; longer names are kept for JavaScript reports only and longer values are truncated. Values above ~4 KB may be uploaded in chunks (`key__1`, `key__2`, …). The names `product`, `version`, `key`, `email`, `comments`, `notes`, `user`, `ipAddress` and anything starting with `electron.` or `bugsplat.` are reserved — use the dedicated setters.

Known limitation: Electron 35 on Linux was observed to omit identity crash keys set from the main process at startup from its native reports (keys added later, e.g. from a renderer, do arrive). Electron 42 and later is verified on all platforms.

Utility processes forked with `utilityProcess.fork()` receive `native.globalExtra` (which cannot change after startup) but not the mutable identity; call `process.crashReporter.addExtraParameter()` inside the utility process if you need it there.

## Renderer setup

- **Sandbox and context isolation** (Electron's defaults) are fully supported. `init()` registers the SDK preload into `session.defaultSession` and every session created later with `session.registerPreloadScript()`, so you don't have to touch your own preload. The preload exposes `window.__bugsplat`, which the renderer SDK uses to talk to the main process.
- **Bundling the preload yourself**: if your packager inlines `@bugsplat/electron` into your main bundle, the SDK can't find `dist/preload.js`. Either set `preload: { path }` to its location, or `import '@bugsplat/electron/preload'` from your own preload (sandboxed preloads must be bundled by webpack/Vite; add the package to `noExternal`) and pass `preload: { register: false }`.
- **Custom sessions and partitions** are covered automatically; `preload: { sessions: [...] }` restricts registration.
- **Content Security Policy**: no `connect-src` is needed. Renderer reports are posted by the main process. Only when no preload bridge exists and you pass `database`/`application`/`version` to the renderer `init()` does it post directly to `https://<database>.bugsplat.com`, which then needs `connect-src`.
- **`nodeIntegration: true` without a preload** also works: the renderer SDK uses `ipcRenderer` directly.
- **Hang call stacks** require the page to opt in with the `Document-Policy: include-js-call-stacks-in-crash-reports` response header. Pages loaded with `loadFile()` (`file://`) cannot set headers, so serve your UI from a custom scheme and add the header with the exported helper:

    ```ts
    import { withJsCallStackPolicy } from '@bugsplat/electron';

    protocol.handle('app', async (request) => {
        const response = await net.fetch(pathToFileURL(fileFor(request.url)).toString());
        return new Response(response.body, {
            headers: withJsCallStackPolicy({ 'content-type': 'text/html' }),
        });
    });
    ```

    For pages you load over HTTP(S) from your own server, add the header there. `unresponsive: { injectDocumentPolicyHeader: true }` adds it through `webRequest.onHeadersReceived` instead, but Electron only keeps the last `onHeadersReceived` listener per session, so use it only if your app doesn't register one.

- **React / Angular**: keep using [`@bugsplat/react`](https://github.com/BugSplat-Git/bugsplat-react) or [`bugsplat-ng`](https://github.com/BugSplat-Git/bugsplat-ng) for component-tree errors. The renderer client is a `BugSplat` instance, so `<ErrorBoundary scope={{ getClient }}>` with `getClient` from `@bugsplat/electron/renderer` reuses the shared identity.

## Symbols and source maps

BugSplat resolves Electron's own symbols automatically. Upload symbols for anything you build yourself with [`@bugsplat/symbol-upload`](https://github.com/BugSplat-Git/symbol-upload) for every released version:

```sh
# JavaScript source maps (main and renderer bundles)
npx @bugsplat/symbol-upload -i $SYMBOL_UPLOAD_CLIENT_ID -s $SYMBOL_UPLOAD_CLIENT_SECRET -d ./dist -f "**/*.js.map"

# Native addons: generate and upload Breakpad symbols from the binaries
npx @bugsplat/symbol-upload -i $SYMBOL_UPLOAD_CLIENT_ID -s $SYMBOL_UPLOAD_CLIENT_SECRET -d ./dist -f "**/*.node" -m
```

`symbol-upload` reads `database`, `name` and `version` from `package.json`; create client credentials on BugSplat's [Integrations](https://app.bugsplat.com/v2/settings/database/integrations) page.

## Testing your integration

Run the example app against your own database:

```sh
git clone https://github.com/BugSplat-Git/bugsplat-electron.git
cd bugsplat-electron && npm ci && npm run build
BUGSPLAT_DATABASE=your-database npm start
```

Each button triggers one scenario: JS errors in main and renderer, manual posts and feedback, native crashes in main, renderer, utility process and native addon, a renderer hang, a renderer OOM, and identity changes from the page. The same scenarios drive the end-to-end suite (`npm run e2e`), which launches the app against local fake BugSplat endpoints and asserts what each one receives.

## Troubleshooting

- **No native report**: `init()` must run before `app.whenReady()`; check `getClient().nativeStarted` and `crashReporter.getLastCrashReport()`. On Linux, Electron's `chrome-sandbox` must be setuid root when the user namespace sandbox is unavailable.
- **No renderer reports / `window.__bugsplat` is undefined**: the preload wasn't injected. See [Renderer setup](#renderer-setup) (bundled package, custom `preload.path`) and make sure `init()` ran before the window was created.
- **No hang report for a hidden window**: Chromium only runs its hung-renderer monitor for visible widgets, so a renderer that hangs while its window is hidden, minimized or fully occluded is not reported until it becomes visible again.
- **Hang reports say `unresponsive.not-opted-in`**: the page lacks the `Document-Policy` header (see above). `unresponsive.timeout` means the renderer wasn't running JavaScript when it hung; `unresponsive.unsupported` means Electron < 33.3.
- **OOM reports without a stack or reading `(stack pending)`**: upgrade to Electron 42.10.1 or later.
- **Wrong application key on native reports**: BugSplat's Electron endpoint currently ignores the `key` crash key (a server fix is in progress); JavaScript reports carry it correctly.
- **TypeScript can't find `@bugsplat/electron/renderer`**: the package ships `typesVersions` for `moduleResolution: node`; make sure you are on TypeScript 4.7+ or use `moduleResolution: bundler`/`node16`.
- **Two reports for one renderer crash**: you enabled `processGone: { renderer: 'all' }`; the default reports only exits without a minidump.

## Contributing

Issues and pull requests are welcome at [BugSplat-Git/bugsplat-electron](https://github.com/BugSplat-Git/bugsplat-electron). See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow (conventional commits, `npm test`, `npm run e2e`).

## License

MIT © BugSplat
