# Electron draft2 acceptance adapter

Real Electron, not Node emulation. The shared harness owns Gherkin, mocks, assertions and strict reporting. This SDK-owned adapter translates public APIs and launches one Electron process with fresh temporary user data per fixture. It does not modify production SDK code or the harness.

**Published conformance is not achieved.** The checked baseline has substantial missing harness steps and unsupported fixture controls. Supplemental integration passes are separate evidence, never a substitute acceptance gate.

## Prepare an installed consumer

Use Node 24. Supply Electron/browser-common/core/types tarballs built together from the SDK revision under test. Build/pack in a disposable checkout using the normal pinned pnpm install and Turbo build; do not reuse stale `target` output or delete another checkout's generated files:

```sh
pnpm install --filter @posthog/electron... --frozen-lockfile --ignore-scripts
pnpm turbo run build --filter=@posthog/electron --force
mkdir /absolute/new/tarballs
pnpm --dir packages/electron pack --out /absolute/new/tarballs/electron.tgz
pnpm --dir packages/core pack --out /absolute/new/tarballs/core.tgz
pnpm --dir packages/types pack --out /absolute/new/tarballs/types.tgz
pnpm --dir packages/browser-common pack --out /absolute/new/tarballs/browser-common.tgz

# Back in the adapter checkout. NEW_CONSUMER must not already exist.
SOURCE_REVISION=FULL_SDK_SHA node compliance/electron/v2/prepare-consumer.mjs \
  /absolute/new/consumer /absolute/new/tarballs/{electron,core,types,browser-common}.tgz
```

Preparation installs actual file tarballs with browser-common/core/types overrides and npm `--before` enforcing a seven-day cutoff across transitive registry resolution, verifies their lockfile resolutions and transitive closure, explicitly downloads Electron 42.4.0, and bundles the installed renderer export using esbuild 0.25.12. `build.json` retains the dependency cutoff, versions, tarball SHA256s, platform, runtime pin and renderer binding hash. `package-lock.json` records tool/runtime dependency resolution. `SOURCE_REVISION` is caller-supplied provenance, not proof of a clean build: retain producer revision/status and build logs. A changed binding requires a fresh consumer; stale renderer bundles are rejected at allocation.

## Run (verified macOS arm64 + OrbStack hybrid)

Docker and a working native GUI session are required. No credentials, production endpoint, MCP or additional privileged preload API is used. Pull the same digest-pinned harness as Node compliance:

```sh
docker pull ghcr.io/posthog/sdk-test-harness-v2@sha256:c1e36d011ec4dec0102fb52b5e6fd3b156b0de9251e0d6b735385876d9a897b4
export POSTHOG_ELECTRON_CONSUMER=/absolute/new/consumer
export SDK_SPECS=/absolute/path/to/sdk-specs # Git object 4a9e0e7 must exist

# Primary: unchanged published full inventory, including missing steps/private controls.
node compliance/electron/v2/run-compliance.mjs electron-main published /absolute/new/main-published
node compliance/electron/v2/run-compliance.mjs electron-renderer published /absolute/new/renderer-published

# Separately labeled SDK-owned integration evidence; NOT published conformance.
node compliance/electron/v2/run-compliance.mjs electron-main supplemental /absolute/new/main-integration
node compliance/electron/v2/run-compliance.mjs electron-renderer supplemental /absolute/new/renderer-integration
```

Every output directory must be new. The wrapper runs actual `posthog-test-harness-v2 run` followed by offline `check-report`, retaining raw exits, reports, matching diagnostics, source/build identity, counts, startup/adapter logs and cleanup results. It fails on either strict failure or zero selected-applicable/executed cases. Docker commands are bounded to 30 seconds, startup to 5 seconds, the run to 20 minutes and adapter termination to 5 seconds. Only uniquely named resources are removed. A nonpassing published run is expected and must not be suppressed in a conformance claim.

The primary source is an unmodified `git archive` of published `PostHog/sdk-specs@4a9e0e7005260dbd198cd67c6ab6579c64679913`, passed through the released CLI's verified `--specs` option. The report records explicit-local-inputs and per-file content identities; `provenance.json` records the exact Git source SHA. No SDK tags or feature content are rewritten. `--all-features` intentionally exposes non-opted-in/missing client coverage: this revision has **zero `@sdk:client` tags**. The narrower opted-in `--acceptance-suite` is not evidence of full client coverage. Supplemental files under `features/` are explicitly SDK-owned, not published specs.

Harness 1.19.0's immutable image was pulled and its `run --help`, `check-report --help`, `steps` and `bundle-info` inspected. Its default bundle pins `def596d735bba8ce05995d61c9ca766bc1c990ff`, **not** the published revision above; explicit inputs avoid that divergence. Canonical harness release 1.31.1 source (`003d416`) was also inspected: it still lacks the identity/consent/session client step catalogue needed here. Upgrading the image does not solve that gap, so the existing Node digest is retained. No harness-repository files were changed.

### Network and sandbox constraints

The controller binds **127.0.0.1** on a random port. The harness container reaches it using `host.docker.internal`; native Electron reaches per-case mock ports on the container's private IPv4 address. OrbStack's native container-IP routing was tested. The wrapper publishes no host ports and creates a unique **standard bridge, not an internal network**. An internal-network trial could not reach the native adapter and executed zero cases; it is retained as a failed routing trial, not acceptance evidence.

This hybrid is **not egress-isolated, offline or hermetic**. The Electron controller accepts only explicit private HTTP mock origins with ports and attaches an Electron `webRequest` permission guard permitting only that exact origin on the SDK session. Allowed SDK traffic still uses the installed SDK's genuine Electron `session.fetch`; it is never intercepted with fake responses. Redirects/out-of-origin requests are denied. Strict local CSP blocks renderer networking. No host firewall, kernel security, sandbox or unrelated Docker resources are changed. Other Docker engines may not route native traffic to container IPs; failures must remain failures.

Renderer windows use `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, the installed production preload, exact local page registration and blocked navigation/window creation. A host-only `executeJavaScript` controller calls the bundled renderer binding. No new production bridge is introduced. Main/renderer exceptions are constructed in their actual JavaScript realm. Never add `--no-sandbox`. Linux nonroot sandbox/Xvfb, Windows, ASAR and packaged applications are not validated by this adapter; the native runner explicitly rejects non-macOS execution.

## Bindings and honest gaps

Negotiated profiles `electron-main` and `electron-renderer` both have semantic `sdk_type: client`, despite batch-v0 wire delivery. Capabilities are `capture_v0`, `capture_v0_batch`, `flags_v2` and fresh-process `storage.empty.v1` only.

| Route                                             | Actual public call                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| `/setup`                                          | main `init(options)` + `ready()`; renderer additionally installed `init()` |
| `/capture`                                        | `capture(event, properties?)`                                              |
| `/identify`                                       | `identify(distinct_id, set?)` (literal person-property map)                |
| `/capture_exception`                              | `captureException(new TypeError(message), properties?)`                    |
| `/flush` / `/reset`                               | `flush()` / `reset()`                                                      |
| `/get_feature_flag` / `/get_feature_flag_payload` | native cached getter, key only                                             |
| `/reload_feature_flags`                           | main `reloadFeatureFlagsAsync()` / renderer `reloadFeatureFlags()`         |

Configuration maps explicit host, batch threshold/interval, capture retries, geoip, disabled, opt-in default, preload/remote flag options, bootstrap, person profiles, flag retries and compression to the corresponding public constructor options. Lifecycle capture is explicitly disabled for these non-lifecycle fixtures; ordinary SDK defaults otherwise remain unchanged. Supplemental wire cases explicitly disable remote/preloaded flags because this harness's generic first-request/count assertions include flags traffic. The bootstrap scenario verifies true/false/variant and decoded payload getters through the installed SDK.

Unsupported parameters are attributed `unsupported_binding`, never silently dropped. In particular per-call `distinct_id`, timestamp and UUID cannot map to this client's capture API; the adapter must not identify first or synthesize wire IDs. JSON numeric precision loss is `blocked_fixture` before any SDK call. Native void, undefined, JSON values and stable exception references remain distinct. SDK argument errors remain native thrown outcomes; controller/configuration gaps are not successful results. No private SDK state, queue/cache or session IDs are read or fabricated.

Clock fixing, arbitrary persistent-storage/queue mutation, scheduler control, immediate delivery, hooks and private fixture operations are not advertised. No fixed-clock or session simulation is installed. Server request-scoped/local evaluation and AI are unsupported. Generic identity getters, consent, session, group/register, callbacks and the newer Electron APIs need canonical harness step/route support and/or a reviewed merged SDK artifact before additional mappings are claimed. Reset has a public mapping and unit coverage, but no published conformance claim. Main's installed baseline getter lacks renderer's optional tracking controls; those arguments remain unsupported instead of pretending parity.

## Checked baseline evidence (not final combined-stack validation)

Initial tarballs were copied read-only from the completed platform lane at producer HEAD `b580fb8d81c1d2624f3c55bc1332dd896d8046b4`. Its SDK/core/types diff against that base was empty; dirty paths were limited to example/workflow changes, retained in artifacts. Installed versions were Electron SDK 0.1.0-alpha.0, core 1.67.2, types 1.424.1, Electron runtime 42.4.0 on macOS arm64, controller Node 24.21.0. Final merged API/delivery changes require freshly rebuilt artifacts and reruns.

Artifacts: `/tmp/electron-draft2.L6jz8E/` (external, not committed):

| Subdirectory               | Selected applicable / executed | Raw run / strict check | Result                |
| -------------------------- | ------------------------------ | ---------------------- | --------------------- |
| `final-main`               | 4 / 4                          | 0 / 0                  | 4 supplemental passed |
| `final-renderer`           | 4 / 4                          | 0 / 0                  | 4 supplemental passed |
| `final-published-main`     | 1170 / 50                      | 1 / 1                  | published nonpassing  |
| `final-published-renderer` | 1170 / 50                      | 1 / 1                  | published nonpassing  |

Each published profile has 1490 inventory rows: 57 blocked fixtures, 65 unsupported bindings, 1047 harness errors (missing generic steps), 1 failed assertion, 57 not applicable and 263 not selected. The assertion is migrated “Empty flush sends no accumulated requests”: preload flag traffic is counted by its broad request assertion. It is retained unchanged, not papered over as SDK success. Unsupported inputs and missing private fixture capabilities are visible in the saved reports. Earlier failed network and supplemental iteration reports are retained separately.

## Focused checks

```sh
# Unit/protocol tests; setting the consumer also executes real Electron isolation tests.
POSTHOG_ELECTRON_CONSUMER=/absolute/new/consumer node --test compliance/electron/v2/*.test.mjs
pnpm exec oxfmt --check compliance/electron/v2
pnpm exec oxlint --config compliance/electron/v2/.oxlintrc.json --report-unused-disable-directives-severity error compliance/electron/v2
```

Eleven tests cover exact public arguments, void/undefined/false/null/zero outcomes, native exceptions, unsupported server-only fields, non-JSON results, both profiles, live-host refusal, number precision, startup deadline and process lifetime. They do not substitute for shared acceptance.
