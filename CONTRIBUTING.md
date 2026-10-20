# Contributing

Thanks for helping improve `@bugsplat/electron`!

## Development

```sh
npm ci
npm run build        # builds dist/ (main, renderer, preload)
npm test             # unit tests (vitest, mocked electron)
npm run e2e          # end-to-end: launches the example app against local fake BugSplat endpoints
npm start            # runs the example app against the real BugSplat database in example/package.json
```

`npm run e2e` needs a display. On Linux use `xvfb-run -a npm run e2e`.

## Conventions

- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:` ...). Releases are cut automatically by
  semantic-release from `main` (and prereleases from `beta`); PR titles are linted.
- `npm run lint`, `npm run format:check` and `npm run typecheck` must pass.
- `src/preload` and `src/shared` must stay self-contained: sandboxed preloads can only `require('electron')`.
- `src/renderer` must not use Node globals; it is compiled against DOM types only.

## Reporting issues

Open an issue at https://github.com/BugSplat-Git/bugsplat-electron/issues or email support@bugsplat.com.
