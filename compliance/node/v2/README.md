# Node compliance adapter (draft v2)

This Node-only HTTP service translates the shared `sdk-compliance-v2-draft2` operations into public `posthog-node` calls. The generic harness owns features, mock services, assertions and reporting. This adapter owns Node argument mappings, process isolation, package builds and its disabled CI caller template.

## Run an installed consumer

Use Node 24 and a consumer directory with `posthog-node` installed from the selected tarballs:

```sh
POSTHOG_NODE_CONSUMER=/absolute/path/to/consumer \
POSTHOG_CAPTURE_MODE=v0 POSTHOG_NODE_MODULE=cjs \
HOST=127.0.0.1 PORT=8080 node compliance/node/v2/server.mjs
```

`POSTHOG_CAPTURE_MODE` is fixed for the process: `v0` advertises `node-legacy`, `v1` advertises `node-analytics-v1`. `POSTHOG_NODE_MODULE=esm` selects native public ESM imports instead of CommonJS. These mappings were initially checked with Node SDK 5.52.4, core 1.54.2 and types 1.412.1; fresh source builds validate the selected revision independently.

The startup JSON line reports the actual bound address and port (`PORT=0` is supported). One listener owns one port. `HOST=::` is a dual-stack wildcard listener; use `127.0.0.1` or `::1` for loopback-only access. DNS hosts select one resolved address, preferring IPv4 when available so Linux clients that omit loopback IPv6 can reach `localhost`. Only bind wildcard addresses on an isolated test network. This unauthenticated service is not a production endpoint.

## Public operations and isolation

`binding.mjs` implements setup, capture, AI capture, flush, feature-flag lookup, reload and local readiness. It renames explicit parameters without changing SDK defaults, preserves absence/null/false/zero, and distinguishes native void, undefined, JSON values and thrown exceptions. Unsupported translations and values without a lossless JSON representation are harness failures, not fabricated SDK results. Timestamps map to `Date` only when lossless. Numeric tokens that round during parsing, exceed the safe-integer range, or lose negative zero through JSON transport produce attributed fixture failures before any SDK call. Invalid representable field values still reach the SDK.

Each fixture gets a fresh child process and SDK receiver. Requests are bounded to at most 60 seconds. Public `shutdown()` closes a fixture; deadline or process failures kill that isolated process and fail the request. Closed fixture IDs and call IDs cannot be reused. No queue/cache state or private evaluator hook is read or mutated. The advertised `storage.empty.v1` means fresh case isolation, not a storage-control API.

The harness supplies local flag definitions over the SDK's public HTTP loading path. It checks exact results and changed results after reload, and disallows remote evaluation traffic throughout the case. Definitions downloads are allowed. The adapter returns only the SDK's actual public outcomes.

## Fresh source build

Build from the repository root. Docker excludes existing dependency/build outputs, runs the normal pinned pnpm install and forced Turbo build, packs Node/core/types, and installs those tarballs in a new consumer. npm overrides prevent registry fallback for core/types. The build checks installed versions, tarball resolution, native CJS/ESM imports and the matching transitive dependency closure. SDK outputs are generated only in the disposable image build tree.

```sh
docker build --file compliance/node/v2/Dockerfile \
  --build-arg "SOURCE_REVISION=$(git rev-parse HEAD)" \
  --tag posthog-node-compliance:local .

# Optional: export fresh tarballs, installed consumer, and build identity.
docker build --file compliance/node/v2/Dockerfile --target packages \
  --build-arg "SOURCE_REVISION=$(git rev-parse HEAD)" \
  --output type=local,dest=/absolute/new/output .
```

The image tests the working-tree build context; `SOURCE_REVISION` is descriptive provenance, not proof of a clean checkout. Record `git status` alongside the SHA when testing local edits. CI checks out the PR head explicitly. `build.json` records package versions, tarball hashes and resolution checks; retain it as a build artifact. Set `NODE_IMAGE` to a digest-pinned Node 24 image for reproducible CI. Run `build-packages.mjs OUTPUT` directly only from a disposable checkout with dependencies installed; it clears generated outputs and refuses to reuse an output directory.

The final adapter image contains Node, the installed consumer and three runtime modules. It has no Python or harness dependency. The harness runs in its own container:

```sh
bash compliance/node/v2/run-compliance.sh posthog-node-compliance:local \
  "$HARNESS_IMAGE" v0 /absolute/new/legacy-reports
bash compliance/node/v2/run-compliance.sh posthog-node-compliance:local \
  "$HARNESS_IMAGE" v1 /absolute/new/analytics-reports
```

Pull the harness image before running. Each invocation creates a separate `--internal` Docker network, publishes no host ports, mounts only reports, records the raw harness exit, and fails on missing/malformed reports, startup or cleanup errors. The harness's `check-report` command independently checks the saved results and matching run/profile diagnostics. SDK failures remain failures. Local Docker commands and cleanup are bounded to 30 seconds each, startup probes to 5 seconds, and the full profile to 20 minutes. Override these positive millisecond bounds with `SDK_COMPLIANCE_COMMAND_TIMEOUT_MS`, `SDK_COMPLIANCE_STARTUP_TIMEOUT_MS` and `SDK_COMPLIANCE_RUN_TIMEOUT_MS` when needed. Timed-out commands return 124 and write deadline diagnostics; startup or cleanup timeouts fail the wrapper. Logs and reports belong in CI artifacts or an external local directory.

`sdk-compliance-v2.yml.example` is a disabled SDK-owned PR caller template. Activation requires separately selected immutable Node/harness image digests in repository variables and approval to enable the workflow. The existing v1 caller remains the active fallback. Do not publish or enable this draft as part of local validation.

## Focused checks

```sh
POSTHOG_NODE_CONSUMER=/absolute/path/to/consumer \
  node --test compliance/node/v2/*.test.mjs
pnpm exec oxlint --report-unused-disable-directives-severity error compliance/node/v2
pnpm exec oxfmt --check compliance/node/v2 .oxlintrc.json
bash -n compliance/node/v2/run-compliance.sh
```

Binding tests use public-method spies for exact translations; HTTP tests also exercise real installed packages in both formats/modes. Controlled SDK stand-ins test deadline, cleanup and process failures, not SDK conformance. Caller tests check raw failure exits and private-network lifecycle. Full migrated profiles and current-base comparisons are separate integration gates owned by the harness run.
