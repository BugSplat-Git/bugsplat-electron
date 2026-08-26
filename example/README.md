# @bugsplat/electron example

The Electron sample maintained alongside the SDK (migrated from the former `my-electron-crasher` repository). It is also the fixture for the end-to-end suite in `../e2e`.

```sh
# from the repository root
npm ci && npm run build
BUGSPLAT_DATABASE=your-database npm start   # or edit "database" in example/package.json
npm run build:addon -w example              # optional: the crashing native addon (needs cmake + a C++ toolchain)
```

Every button triggers one scenario (also reachable as `electron dist/main.js --scenario=<name>`): JavaScript errors and rejections in main and renderer, manual posts and feedback, native crashes in main / renderer / utility process / native addon, a JavaScript hang and a native hang, a renderer out-of-memory crash, and identity changes from the page.

- `src/main.ts` — `init()` before `app.whenReady()`, `app://` scheme with the `Document-Policy` header for hang call stacks, scenario dispatch
- `src/preload.ts` — the app's own preload (no BugSplat code; the SDK registers its own preload)
- `src/renderer.ts` — plain page script calling `BugSplatElectron.init()` from the global build in `dist/vendor/`
- `src/plugin/` + `CMakeLists.txt` — the native addon used by the "crash inside a native addon" scenario
