# Platform and packaging smoke fixtures

These credential-free tests extend the existing two-window smoke; every profile still runs its full renderer, identity, consent, flags, handled-exception and HTTP wire assertions. They do not enable replay, native crashes, surveys or product tours.

After the [example setup](../README.md), run from `examples/example-electron`:

```sh
pnpm test                 # original plain application
pnpm test:asar            # original ASAR application
pnpm test:platform        # profiles below, plus all three together inside ASAR
```

- `composed`: esbuild bundles the SDK's `exposePostHogBridge` helper and an application-owned contextBridge API into one CJS preload, with only `electron` external. Both APIs must work in both sandboxed windows.
- `scheme`: serves an exact, local asset allowlist through a standard, secure custom scheme. The page must report a secure context; the strict CSP remains enabled. Each window is registered with the SDK's exact custom URL before navigation.
- `partitions`: explicitly registers windows in a named persistent partition and a distinct in-memory partition. Cookies must be isolated from each other and the default session, while SDK identity/session/consent remain shared.
- `platform`: combines all of the above, including scheme handlers installed on each partition's session.

Run one case with `node smoke-test.mjs --fixture=scheme` after `pnpm build`. Linux needs a desktop display or `xvfb-run -a`; never use `--no-sandbox`.

## Genuine installed-consumer packaging

The independent `../packaging` pnpm workspace installs local SDK tarballs, not source links. Its hook rewrites **all** PostHog production dependencies to `target/*.tgz`; generate them through Turbo's package dependency graph as in the example setup. The hoisted node linker lets the packagers discover normal consumer dependencies. Neither packager manually copies the SDK or core.

Build the example first, then:

```sh
cd packaging
pnpm install --ignore-scripts
pnpm --version                        # 11.7.0
pnpm config get minimumReleaseAge     # 10080
node node_modules/electron/install.js # explicit binary installation, no broad lifecycle approval
pnpm test:forge
pnpm test:builder
```

Forge's actual package API and Builder's actual `dir` target produce native applications with an ASAR payload. Each resulting app is copied intact to a temporary directory with no `node_modules` ancestors, preserving framework symlinks. The executable runs from that isolated directory with `NODE_PATH` cleared, using the combined `platform` profile, original smoke assertions and temporary userData/mock receiver. It must report `app.isPackaged` and an `app.asar` application path.

Each command first tests a throwaway copy with `@posthog/core` removed from its ASAR: launch must fail specifically with the native `ERR_MODULE_NOT_FOUND` diagnostic, not borrow the workspace dependency or time out. A packaging-only bootstrap reports import errors and exits nonzero; it otherwise imports the unchanged example main. The untampered package must then pass every original smoke assertion. Generated applications stay in ignored `packaging/dist/` for inspection; temporary launch/control copies are removed.

These are unsigned/unnotarized unpacked applications, not installer, signing, native-module or store-distribution tests. Builder explicitly skips signing and native rebuilding (the consumer has no native modules); Forge has no signing or maker configuration. No secrets are needed. All test launches retain `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` and no renderer Node access.

### Dependency pins and CI

New tooling is isolated to the packaging workspace: `@electron-forge/core@8.0.1` (published 2026-09-29) and `electron-builder@26.11.0` (2026-05-19). Older Forge 7/Builder 26.0 pins used a git-hosted node-gyp dependency rejected by `blockExoticSubdeps`; the selected mature pins need no policy exception. The workspace retains a seven-day cooldown and pnpm 11.7.0. The existing example esbuild is reused to build assets; no SDK or root lockfile dependency changes are required.

`.github/workflows/electron-platform.yml` builds/packs the SDK graph once, transfers those tarballs to native macOS/Windows/Linux runners, and tests exact Electron `41.0.2`, `42.4.0` and `43.0.0` (published 2026-03-13, 2026-06-09 and 2026-06-30). Each cell runs original plain/ASAR, runtime profiles, Forge and Builder. Installs suppress dependency scripts and explicitly run Electron's installer. Linux uses Xvfb; jobs have read-only contents permission and use no fork secrets.

To reproduce another version locally, run `pnpm add --save-dev --save-exact electron@43.0.0 --ignore-scripts` and `node node_modules/electron/install.js` in **both** workspaces, then rerun the commands above. Restore the checked-in `42.4.0` pins afterward. `ELECTRON_BINARY` only changes direct example launches, not the runtime embedded by a packager.

### Actual local validation

macOS arm64, Node 24.21.0, pnpm 11.7.0: Electron **41.0.2, 42.4.0 and 43.0.0** each passed plain, ASAR, composed, scheme, partitions, combined-ASAR, Forge-packaged and Builder-packaged runs (24 distinct runtime/packager cases; 15 asserted wire events per run). The mock receiver's two tests also passed. Windows/Linux remain CI-only gates, not claimed local results; signing, notarization and installers were deliberately not run.
