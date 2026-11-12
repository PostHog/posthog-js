# Electron example

A real Electron app using `@posthog/electron` (`0.1.0-alpha.0`), with one main-process SDK owner and a sandboxed renderer facade. No project token is required: by default a local HTTP receiver prints captured events in the terminal and returns an `electron-example` flag (`local-variant`) with a JSON payload.

This demonstrates explicit main/renderer capture, shared identify/reset, groups, registered properties, consent, feature flags, handled JavaScript exceptions, and flushing. It does **not** demonstrate or claim support for session replay, native crashes, surveys, product tours, or browser autocapture.

## Build and install

Use the repository's Node version (`nvm use` at the root) and Corepack. First build and pack the SDK and its dependencies from the repository root:

```sh
pnpm install --frozen-lockfile
PACKAGE_DEST="$PWD/target" pnpm turbo run package --filter=@posthog/electron
```

This must produce `target/posthog-electron.tgz` and `target/posthog-core.tgz` (plus any other transitive PostHog package tarballs). Then:

```sh
cd examples/example-electron
pnpm install
pnpm --version                         # 11.7.0
pnpm config get minimumReleaseAge      # 10080
```

This is an independent pnpm workspace. `../.pnpmfile.cjs` rewrites PostHog dependencies, including `@posthog/electron` and `@posthog/core`, to `../../target` tarballs. Rebuild/repack at the root, reinstall here, and restart after SDK changes. Main/preload load the installed SDK package directly; esbuild bundles only the renderer and its SDK facade into a local script.

The shared installation policy disables Electron's lifecycle install script. If its binary is missing, explicitly download it with:

```sh
node node_modules/electron/install.js
```

Do not broadly enable dependency lifecycle scripts. Electron is pinned to `42.4.0`; esbuild uses `^0.25.0`.

## Run the interactive app

```sh
pnpm build
pnpm start                 # also rebuilds the renderer
```

Click the controls and inspect the shared state view. Main captures `electron_main_startup`; the capture button emits `electron_renderer_button`. The mock receiver logs wire events in the terminal. Consent is app-wide, so opting out suppresses main and renderer events, not just UI button events. The interactive app uses Electron's normal `userData` directory, so identity and consent survive restarts; use **Opt in** if a previous run opted out.

To send to a real project instead, supply a project token (never a personal API key):

```sh
POSTHOG_PROJECT_TOKEN=phc_your_token POSTHOG_HOST=https://us.i.posthog.com pnpm start
```

`POSTHOG_HOST` is optional with a real token; without a token the app always uses the local mock, ignoring that host. The fixture flag exists only in mock mode; a live project needs its own `electron-example` flag.

## Real Electron smoke test

After installing the SDK tarballs and Electron binary:

```sh
pnpm test                 # builds, then runs node smoke-test.mjs
pnpm test:asar            # same assertions with the app and installed SDK packed into app.asar
# Linux without a display:
xvfb-run -a pnpm test
# Test another installed Electron runtime:
ELECTRON_BINARY=/absolute/path/to/electron pnpm test
```

`smoke-test.mjs` starts a loopback receiver, creates a temporary `userData` directory, and launches the installed Electron executable with `--smoke-test`. Live PostHog environment variables are removed and ignored. The Electron main process creates **two actual sandboxed BrowserWindows**; `smoke-driver.mjs` uses `webContents.executeJavaScript` to call the real, initialized renderer facade in each window. `window.examplePostHog` is just that facade, not an extra privileged IPC API.

Assertions cover:

- Main/renderer process context and real HTTP batch delivery.
- Shared anonymous identity/session, identify, reset, groups, register/unregister, and state subscriptions across two windows.
- Shared opt-out suppressing captures from both renderers and main, then restored capture after opt-in.
- Remote fixture flags/payloads and a renderer feature-flag exposure event.
- A handled renderer exception with structured exception metadata and a stack.
- No `$snapshot` events or replay endpoints even when the mock project enables recording, plus sandbox/context-isolation settings and no renderer Node access.

Failures or a 45-second timeout produce a nonzero exit. SDK `flush()` completes delivery and disk writes before shutdown. The receiver and temporary app data are cleaned up. This uses Electron-under-test, not browser automation, and does not launch a separate Chrome installation. Run as a normal desktop user (or with Xvfb on Linux); do not disable the sandbox to make the test pass.

The receiver can also be tested independently, without installing dependencies or launching Electron:

```sh
node --test mock-server.test.mjs
```

## Local validation record

Validated on macOS arm64 with Node 24.21.0:

- Electron 41.0.2 and 42.4.0: unpacked and ASAR-packed app, two sandboxed windows, 15 asserted wire events per run.
- SDK: 49 unit tests and 3 built-export/preload checks; semantic types, lint and formatting pass.
- Shared core: 2,380 passing tests, one existing skipped test; semantic types pass.
- Example mock receiver: 2 passing tests; workspace build-graph and dependency-cooldown checks pass.

This is alpha validation, not a Windows/Linux test result, signed installer test, live PostHog integration test or cross-SDK acceptance-harness conformance claim. Electron 41 emitted a macOS sandbox-extension diagnostic when launched from the temporary extraction directory; its assertions passed without disabling sandboxing.

## Security layout

- `main.mjs` calls `init` and awaits `ready()` before creating any window.
- The packaged, standalone CJS SDK preload is resolved in ESM with `createRequire` and `require.resolve('@posthog/electron/preload')`.
- Each window is admitted with `registerWindow(window, { allowedUrls: [pathToFileURL(indexHtml).href] })` **before** loading its page and deregistered on close.
- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; new windows and page navigation are blocked.
- Static strict CSP, local bundled script/styles, no inline or remote code and no renderer network access.
- There is no sample-owned privileged IPC or custom preload. Only main talks to the receiver/PostHog and owns storage and identity.
- Normal quit awaits `shutdown(5000)` before completing exit.
