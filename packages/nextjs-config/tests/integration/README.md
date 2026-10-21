# Next.js release and cache regressions

These tests run real Next.js 14 and 16 webpack builds and Chromium. They are separate from unit/built-output tests because they install framework dependencies and need a browser. No PostHog credentials are needed.

From the repository root:

```sh
pnpm --filter posthog-js exec playwright install chromium
pnpm test:nextjs-integration
```

The root command builds the current browser SDK, Node SDK and Next.js integration (including dependencies) through Turbo. If these outputs already exist, `pnpm --filter @posthog/nextjs-config test:integration` runs just the harness. CI installs Chromium's Linux system dependencies with `--with-deps`.

## Isolation and coverage

- The framework/third-party workspace in `fixtures/` has pinned versions, a committed lockfile and the repository's seven-day dependency cooldown. It is copied into a fresh temporary directory and installed with `--frozen-lockfile --ignore-scripts`.
- Current PostHog packages and their workspace runtime dependencies are packed and unpacked into each consumer's `node_modules`. They are not linked back to the checkout. Framework peers and third-party dependencies resolve from the isolated fixture install. New external SDK dependencies require updating the fixture pins/lockfile.
- Both production compilers use webpack build workers. Each app is built twice with different mock release IDs and a fixed Next build ID. The second build starts without the first build's output or `.next/cache`.
- Shared immutable JavaScript URLs must retain identical bytes; the runtime URL must change. Chromium serves shared assets from the previous build while loading the new deployment and exercising a lazy chunk.
- Browser captures cover the minimum supported `posthog-js@1.438.5` CDN bundle, the current CDN bundle, and the current bundled SDK. CDN scripts are served locally, outside Next's compilation. Deleting the release global is a negative control for the CDN SDKs.
- A Pages Router API actually externalizes the current `posthog-node` and captures an exception with runtime `POSTHOG_RELEASE_ID` unset. Both deployments must report their correct release.
- The mock CLI rejects post-build `process` calls, checks every uploaded JS/map chunk ID, and records asset hashes. The harness checks files remain unchanged after upload and uploaded maps are deleted. A mock CLI error fails the test even though the plugin itself is fail-soft.
- Next 16 also runs `next dev --webpack`. Actual dev/build workers must install the plugin without inherited CLI flags, artificial `WEBPACK`/`TURBOPACK` overrides, or the Turbopack upload hook.
- Browser bot filtering is disabled for controlled Playwright captures. Events are inspected in `before_send` and dropped. Browser analytics requests are intercepted; unexpected external requests fail the test. Node analytics transport throws if called.

The harness targets Linux/macOS. Ports are allocated dynamically. Servers/builds have bounded lifetimes and their process groups are terminated on failure or interruption. Successful temporary workspaces are removed; failed ones are retained locally for inspection. This is not a hosted Vercel or live-upload test, nor a Turbopack test.

## Diagnostics and CI selection

Every run writes build/server/CLI/worker logs, asset-hash comparisons, capture checks and browser traces under `test-results/nextjs-integration/run-*/`. CI uploads this directory on failure. Use `pnpm --filter posthog-js exec playwright show-trace <trace.zip>` to inspect a trace.

The `Next.js integration` workflow uses the existing dependency-aware affected-package check for `@posthog/nextjs-config`, plus explicit SDK consumer, build and workflow paths. Unrelated source changes skip the test job without skipping the workflow. Manual dispatch forces the tests, and a failed/unknown affected check also runs them conservatively. CI caches fixture dependency/browser downloads, never Next build output; `NEXTJS_INTEGRATION_STORE_DIR` optionally selects a dedicated fixture pnpm store.

Fast harness assertions also run under `test:built`, including negative controls for immutable-URL collisions, missing worker instrumentation and failed/missing uploads.
