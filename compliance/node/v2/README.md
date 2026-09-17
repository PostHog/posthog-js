# Node v2 packaged-source host

A bounded host for an installed public `posthog-node` package from an explicitly
selected SDK checkout. The existing v1 adapter is unchanged.
This is not an SDK-conformance claim or a replacement for the full adapter.

## Run

Build in Linux containers from a snapshot of your selected checkout (Docker required):

```sh
python compliance/node/v2/build-packages.py --sdk-root "$PWD" --out "$BUILD_OUTPUT" \
  --node-image "$NODE_IMAGE" \
  --runner-image "$RUNNER_IMAGE" --adapter-image posthog-node-v2:local
```

`BUILD_OUTPUT` must be a fresh directory outside the checkout. Select a Node 24
image compatible with the repository engine; use an image digest for repeatability.
The optional runner/adapter image pair assembles a bounded adapter image using the
packaged harness runtime and its bundled contracts. It is not published.

The builder copies tracked and nonignored untracked files, including dirty source,
without reusing ignored build outputs or dependencies. It installs with the selected
checkout's `packageManager` and frozen pnpm lockfile, then runs the existing Turbo
Node build graph (types, core, Node) with forced rebuilds. Fresh public tarballs are
installed by npm into `packages/consumer`; overrides force both core and types to
the fresh local tarballs. The builder verifies the Node entry resolves that exact
core installation, and records installed identities, tarball hashes, all snapshot
source hashes, actual Git HEAD/status, commands and logs in `provenance.json`.
HEAD identifies the base, not any dirty/untracked work included in the snapshot.
The consumer is Linux-built; run native checks in the corresponding Linux runtime.
The standalone host only consumes packages; it does not build or install them.

From the harness worktree (its locked environment supplies aiohttp and the production
`posthog_test_harness.v2.contracts.Contracts` implementation):

```sh
uv run --locked python ../node/compliance/node/v2/host.py \
  --contracts ../specs/contracts/v2 \
  --consumer "$BUILD_OUTPUT/packages/consumer"
```

The first stdout line is an ephemeral `http://127.0.0.1:PORT` URL by default.
`--listen-host HOST` and `--listen-port PORT` explicitly select the control listener;
defaults remain `127.0.0.1` and `0` (OS-allocated port). Hosts accept DNS names, IPv4,
or bare IPv6 (`::1`, bracketed only in the printed URL), not URLs, host:port,
credentials, paths, or zone identifiers. Ports must be in 0–65535.

For a private two-container Docker network, opt in with
`--listen-host 0.0.0.0 --listen-port 8080`; give this container alias `adapter` and
use `--adapter-url http://adapter:8080 --allow-private-network` from the runner.
That runner opt-in permits the chosen host; it does not verify network privacy.
The printed wildcard address describes
the listener, not a reachable advertised endpoint. Do not publish host ports.
The runner must separately set `--mock-bind-host 0.0.0.0 --mock-advertised-host runner`
with its own `runner` network alias, because SDK loopback refers to this adapter's
network namespace. Neither process derives a routable hostname from wildcard binding.

The default
`--capture-mode v0` exposes profile `node-legacy`. Start a separate host with
`--capture-mode v1` for profile `node-analytics-v1`. SDK diagnostics go to stderr. The host checks the
installed package metadata and resolves **only the public** `posthog-node` CommonJS
entry via `createRequire(consumer/package.json)`; no source/deep SDK imports.
Probe and fixture workers must agree on version, package metadata and public-entry
hashes, runtime, routes and mode; mutation after probing fails allocation. These
handshake checks are identity checks, not whole-package provenance; the build
manifest supplies source and tarball provenance. Node on PATH must satisfy the packaged SDK's engine requirement.
Each child gets the explicitly selected `POSTHOG_CAPTURE_MODE`, fixing its native
capture mode independently of the controller's environment. This is the SDK's
existing environment opt-in, not a simulated per-instance setup option.

## Supported slice

Exactly seven public operations:

| RPC                 | Native call / mapping                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/setup`            | `new PostHog(project_token, config)`; omitted arguments stay omitted                                                                |
| `/capture`          | `capture({...})`; `distinct_id`, `disable_geoip`, `send_feature_flags` map to camelCase; event/properties/groups/uuid retain values |
| `/capture_ai`       | `captureAi({...})`; native synchronous UUID/undefined result, with the same supported EventMessage field mappings                    |
| `/flush`            | `await flush()` with no native arguments                                                                                            |
| `/get_feature_flag` | `await getFeatureFlag(key, distinct_id, options)`                                                                                   |
| `/reload_feature_flags` | `await reloadFeatureFlags()`; no implicit readiness or HTTP calls |
| `/wait_for_local_evaluation_ready` | `await waitForLocalEvaluationReady(timeout_ms)`; omitted timeout stays omitted |

Setup maps only `host`, `flush_at → flushAt`, `flush_interval_ms → flushInterval`,
`max_retries → fetchRetryCount`, `disable_geoip → disableGeoip`,
`historical_migration → historicalMigration`, `secret_key → secretKey`, and
`compression: none/gzip → disableCompression: true/false`. Omitted options retain
native defaults. `max_retries` controls the native capture retry setting,
not the independent flag-request retry configuration. Native retry delays are
unchanged in both modes.

Getter options map `groups`, `person_properties → personProperties`,
`group_properties → groupProperties`, `only_evaluate_locally → onlyEvaluateLocally`,
`send_event → sendFeatureFlagEvents`, and `disable_geoip → disableGeoip`.
Capture's `send_feature_flags` object supports `only_evaluate_locally`,
`person_properties`, `group_properties`, and `flag_keys`, with camelCase names.
Analytics-v1 `/capture.options` map to SDK-owned sentinel properties:
`cookieless_mode → $cookieless_mode`, `disable_skew_correction → $ignore_sent_at`,
`process_person_profile → $process_person_profile`, and
`product_tour_id → $product_tour_id`. The SDK's native transform lifts and coerces
these properties into wire options; the adapter passes the values unchanged and
never builds the HTTP payload. A collision with an explicitly supplied sentinel
property, or combining options with non-object properties, is a fixture blocker.
The legacy profile does not bind these v1 options.

All other supplied parameters, including explicit false/null unsupported options,
produce attributed `unsupported_binding` completions. They are never dropped.

Capture timestamps with valid explicit offsets and millisecond-exact precision
become native `Date` objects preserving the instant; invalid calendar strings and
nonzero sub-millisecond precision are `blocked_fixture`. Non-string negative
inputs pass unchanged. Precision-losing JSON numbers are blocked before Node sees
rounded inputs. Protocol envelopes/references are validated, but semantic argument
schemas are **not** admission gates.

Native `capture(): void`, `flush(): Promise<void>` and
`reloadFeatureFlags(): Promise<void>` signatures in
`packages/node/src/client.ts` justify classifying undefined completion as void.
Construction uses the contract's void setup convention. `captureAi(): string | undefined`
returns the native generated/supplied UUID or native undefined, never a placeholder.
Getter, AI and readiness undefined remain `undefined`, not null or void. Actual data results are retained even on void-declared
methods. Actual exceptions remain retained native objects until process disposal;
non-JSON results without a lossless selected representation are blockers.

## Isolation and declarations

One isolated Node child per fixture, with a Python control loop enforcing deadlines
and cancellation even during a blocked JavaScript event loop. Timeout/cancel
invalidates the receiver and kills the child; first terminal completion wins.
Close is idempotent process disposal, not an SDK flush/reset/shutdown. Receipts
remain observable after close. SIGINT/SIGTERM perform host cleanup.

Both profiles declare server/request-scoped identity, `capture_ai_v0`, `encoding_gzip`, `flags_v2`
and `flags_getter_remote_uncached`, plus `feature_flags_local_evaluation_v1`. The legacy profile declares protocol `legacy`
and `capture_v0`/`capture_v0_batch`; the analytics-v1 profile declares protocol
`analytics_v1` and `capture_v1`. Deflate, Brotli and Zstd are not supported by this
SDK binding. Relevant source seams:

- `packages/node/src/client.ts`: public `captureAi` returns its native UUID and
  selects `AI_CAPTURE_ROUTE`; `ai-capture/routing.ts` supplies `/i/v0/ai/batch/`.
- `packages/node/src/capture-v1/config.ts`: native v0/v1 capture mode selection.
- `packages/node/src/capture-v1/transform.ts`: SDK-owned option-property aliases.
- `packages/node/src/capture-v1/sender.ts`: native v1 requests, retries and compression.
- `packages/core/src/posthog-core-stateless.ts`: `/batch/`, `/flags/?v=2`, native
  retry/GeoIP/compression defaults.
- `packages/node/src/entrypoints/index.node.ts`, `gzip.node.ts`: native gzip.
- `packages/node/src/client.ts`: the ordinary getter's remote fallback issues a
  fresh flags request; no definition poller is constructed without a personal key.
  A supplied `secretKey` enables the native definitions poller. Definitions loading,
  polling and refresh retain native defaults; no definitions or result caches are installed.

The native `flags.evaluation_provenance.v1` fixture observes the installed poller's
`computeFlagAndPayloadLocally` method on the real SDK instance. Its wrapper preserves
the native promise, receiver, arguments, value and error. `AsyncLocalStorage` associates
that component's conclusive boolean/string with the live public getter call; public
getter output, counters and absent HTTP are not used to infer local evaluation.
Only an unambiguous, single conclusive component call produces an observation.
Missing or unwritable hooks, incompatible return shapes, absent or late results and non-string/empty public lookup keys
cannot supply this string-keyed observation and remain explicit fixture blockers;
the public getter result is unchanged. Remote provenance is not implemented.

`POST /v2/fixtures/flags` reads completed observations without SDK work, under a real
deadline. Records are bounded to 1 MiB per fixture, validated against owning call/key,
and cleared on invalidation or close. Unknown/foreign calls cannot borrow records;
queries during an owning invocation are rejected. Child disposal removes the hook
and pending work. Public reload completion and readiness do not prove a fresh fetch:
the migration runner separately checks authenticated definitions HTTP 200 traffic.

The other native fixture capability is `storage.empty.v1`:
`POST /v2/fixtures/flush` with `storage_empty` is admitted only before any setup
attempt and while no invocation owns the fresh child. In the selected implementation, each Node
client creates a new `PostHogMemoryStorage` whose initial backing object is `{}`
(`client.ts`, `storage-memory.ts`). Fresh process allocation prepares its isolated
namespace without constructing/resetting the SDK or touching storage internals.
Post-setup storage preparation and clock/scheduler/queue controls are blocked.
Reference construction, callbacks, context scopes and other native fixtures are
not implemented or advertised. Native returned exceptions can be retained, but
this slice does not inject them into SDK arguments.

## Checks

From the Node worktree:

```sh
POSTHOG_NODE_CONSUMER="$BUILD_OUTPUT/packages/consumer" \
  node --test compliance/node/v2/binding.test.mjs compliance/node/v2/local-observer.test.mjs
POSTHOG_V2_CONTRACTS=../specs/contracts/v2 \
POSTHOG_NODE_CONSUMER="$BUILD_OUTPUT/packages/consumer" \
  ../harness/.venv/bin/python -m pytest -q --asyncio-mode=auto \
  compliance/node/v2/test_host.py compliance/node/v2/test_ai_host.py compliance/node/v2/test_local_host.py
```

Binding tests spy on the real packaged public constructor/methods. Observer unit tests
use a controlled component seam to verify correlation and promise/error preservation. Python control tests
use an explicitly test-only temporary consumer to exercise invalid frames,
reference/lifecycle rules, blocked loops and cancellation; they are not SDK passes.
The separately labeled real-consumer smoke test uses a local HTTP service and the
installed public entry point. Wider migration parity and v1 comparisons belong to
the parent calibration evidence, not these unit tests.

Remaining limitations: independently supplied consumers require their own provenance;
CI integration is not included; unsupported fixtures/parameters remain gaps.
A getter's native undefined can fail a catalog result target: preserve that evidence
rather than fabricating null or appending a flush.
