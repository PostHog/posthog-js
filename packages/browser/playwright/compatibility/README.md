# Browser deployment compatibility snapshots

This credential-free suite exercises production-packed `posthog-js` through its native snippet, regular npm and slim npm entrypoints. Historical deployments keep published `posthog-js@1.354.0` core bytes for snippet and regular npm, and `posthog-js@1.407.6` for slim with `AllExtensions`. Both load the current checkout's CDN extensions. SDK methods and extension setup are not replaced by the harness.

## Commands

Use Node 24 and the repository's pnpm version. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter posthog-js exec playwright install chromium firefox webkit
pnpm turbo run build --filter=@posthog-tooling/sdk-mock-server
pnpm --filter posthog-js compatibility:self-test
pnpm --filter posthog-js compatibility:controls
pnpm --filter posthog-js compatibility:test

# Explicitly regenerate all six files for code review:
pnpm --filter posthog-js compatibility:update

# A focused, read-only check (reported as partial):
pnpm --filter posthog-js compatibility:test --engines chromium --modes npm --comparisons current --scenarios core,logs
```

Both test and update build this checkout using its normal production build, pack its SDK/workspace dependencies, install isolated consumers and execute at least two repeats per selected cell. Registry access is needed for preparation; browser traffic is restricted to the local fixture/backend server. Native HTTP traffic uses a deny-only proxy without loopback bypass. Chromium/Firefox traffic is not intercepted by Playwright, preserving navigation/Beacon delivery; WebKit additionally aborts HTTPS requests because its macOS HTTP proxy can be bypassed for TLS. Live controls require zero connections to other loopback HTTP/HTTPS origins. Standalone consumers use pnpm 11.7.0 with a seven-day dependency cooldown, exact current dependency overrides, local PostHog tarballs, and frozen dependency locks for both historical packages. No product credentials are required. Install browser system dependencies on Linux with Playwright's `install --with-deps` command or use the CI's pinned Playwright image.

Selectors are comma-separated `--engines`, `--modes`, `--comparisons` (`current,historical`) and `--scenarios`. `--repeats` may increase the repeat count, never reduce it below two. `--output /path/to/new-directory` selects a new evidence directory; existing directories are rejected. The default is a unique directory under the ignored repository-root `test-results/compatibility/`. Controls likewise accept `--output`.

A full run comprises 450 cells / 900 executions: two core families × three entrypoints × three engines × 25 scenarios. `goldens/` contains exactly six readable JSON files, each with 75 cells. Updates reject partial/incomplete coverage, functional failures, unexpected errors, changed inputs and unequal repetitions before publishing a staged complete directory. Checks never write expected files. Semantic differences in `runs/report.json` identify deployment, browser, scenario, JSON path and expected/actual values. Ordered callbacks and nested payload batches remain ordered.

Follow the [snapshot update criteria in the browser contributor guide](../../CONTRIBUTING.md#deployment-compatibility-snapshots) before regenerating expectations.

## Evidence and reproducibility

Each execution records settings, raw API/UI/replay/network observations, complete HTTP wire evidence (including exact body bytes in base64), normalized observations and backend inspection. Failures retain `failure.json` and a best-effort screenshot. Matrix evidence records actual versions, host, browser versions, source state, tarballs, consumer locks and expected/before/after SHA-256 inventories. Uncommitted source additions, changes and deletions are fingerprinted as the working tree, not attributed to an unchanged HEAD. No staging or stashing is required.

The normalization retains null/missing/explicit undefined/error distinctions, application values, coordinates, privacy markers, identity relationships, decoded replay content and compression versions. Replay network records normalize only finite native clock fields (`startTime`, `endTime`, `timeOrigin`, `timestamp`) and known navigation/resource timing measurements; independent assertions validate the fixture requests' ordering and clock relationship first. Request/response headers, bodies, methods, status, URLs and record order remain observable. Only recognized core/extension metadata is replaced with role tokens after asserting the actual value against its manifest. Raw evidence retains actual versions. Independent HTTP deliveries may reorder; arrays inside delivered batches and callbacks do not. Pending-barrier samples and known CPU/encoded-size diagnostics are preserved raw, with bounded normalization used for comparison. Web Vitals compares delivery and metric structure, not exact FCP values or ratings: finite nonnegative measurements, recognized ratings and SDK metric IDs normalize only inside `$web_vitals` events; raw measurements remain in the evidence.

The execution profile fixes viewport (1024×768), locale, UTC timezone, light color scheme, reduced motion, blocked service workers and the pinned Playwright 1.52 Desktop Chrome/Firefox/Safari user agents. Chrome/Firefox report the profile's Windows desktop OS; Safari reports macOS. OS/device attributes remain observable, including in logs. This profile emulates those desktop user agents; it does not change the host OS or claim complete device emulation. Host-dependent rendering and browser implementation differences must still pass the same snapshots on each supported host. Browser binaries, Playwright code and the native bundler are fingerprinted. Firefox's installation-local `.parentlock` runtime file is excluded from the tooling inventory. Browser/tooling upgrades require reviewed snapshot changes. Interaction and replay-lifecycle scenarios use a paused Playwright clock and synchronize native browser/config execution before advancing timers. The replay network scenario freezes only Date, preserving native `performance.now()`, resource timings and timer scheduling; other scenarios use Playwright's fixed-time clock. Large replay idle intervals advance in bounded steps, draining native HTTP between steps so simulated time cannot race real responses. Only navigation-ending `unload` and `replay-bounce` enable request batching; the HTTPS egress guard remains active.

## Independent behavior gates and controls

Scenarios cover core lifecycle, identity/reset/consent/flags, autocapture, surveys, logs, replay, disabled products, extension failure, delayed loading, unload, version fallback, listener cleanup, forms, links, rage/dead clicks, scrolling and heatmaps. Functional, privacy, exact-once delivery and native-loader/UI assertions run in both check and update mode.

Additional product and replay cases cover:

- Automatic survey appearance, textarea input and submission through the rendered UI, alongside the existing manual-display case.
- Real browser FCP collection and backend `$web_vitals` delivery with valid metric fields and matching session/window/URL metadata.
- Replay network request/response headers and bodies: harmless JSON remains complete, sensitive headers and password bodies are redacted, and native requests/responses retain their original content. This scenario uses the existing `_forceAllowLocalhostNetworkCapture` test override in the loaded callback to enable the recorder on the loopback fixture; fetch and masking implementations are not replaced.
- Replay CSS variables with shorthand/longhand declarations and pre-snapshot `insertRule()`, checked against both original and reconstructed computed styles.
- Cold start with legacy persisted recording config lacking `cache_timestamp`, held live config, a capture while waiting, preservation of the saved config and recording after release. Startup before live config is observed rather than forced: current cores wait for fresh config, while historical cores use their own policy.
- Recording idle/wake, analytics-session rotation, passive real-navigation unload and minimum-duration gating, with full snapshots, privacy checks and reconstruction of the changed DOM.

Self-tests protect small semantic API/payload changes, nested batch/callback order, exact coverage, repeat equality, historical source attribution and update publication/rollback faults. Live controls first alter an artifact without repinning and require rejection before browser execution. They then pin a throwing survey CDN script and require failures through both current and historical native loaders. A separate control removes `captureLog` from the prepared current consumer and requires log scenarios to fail instead of publishing new expectations. An empty Web Vitals CDN extension must also fail both current and historical delivery scenarios. Disabling Replay header/body capture must fail both core families even when the application requests succeed, preventing an update from accepting missing network records. Expected snapshots remain unchanged in all controls.

## Historical coverage and limits

The historical pins are independently verified against their published SHA-512 package integrities and frozen consumer locks. Slim uses `1.407.6`, which preserves private names across its core and extension bundles. All 450 cells must reach full functional readiness and pass the independent behavior gates.

Historical logs API coverage is unavailable. Historical version-fallback cases use `strict_script_versioning: false` and prove only the legacy loader path; current cases use `'fallback'` and require a versioned 404 followed by legacy success and rendered survey UI. Disabled products retain enabled flags. Survey coverage is one open-text popover. Scrolling uses explicit public pageview/pageleave captures around native wheel input, not automatic navigation pageleave. This is not exhaustive SDK, historical-version, quota/retry, survey-type, CJS, touch or production-ingestion coverage. Shared mock routes are synthetic backend responses, not ingestion-service conformance.

The CI job is read-only and credential-free and retains diagnostic artifacts on failure. Run the same full check on Linux before claiming host portability; a passing run on one host alone does not establish that gate.
