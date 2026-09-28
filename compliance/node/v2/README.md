# Node compliance adapter (draft v2)

This Node-only HTTP service translates the shared `sdk-compliance-v2-draft2` operations into public `posthog-node` calls. The generic harness owns features, mock services, assertions and reporting. This adapter owns Node argument mappings, process isolation, package builds and its SDK-owned CI workflow.

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

`binding.mjs` implements setup, capture, AI capture, flush, feature-flag lookup and reload. It renames explicit parameters without changing SDK defaults, preserves absence/null/false/zero, and distinguishes native void, undefined, JSON values and thrown exceptions. Unsupported translations and values without a lossless JSON representation are harness failures, not fabricated SDK results. Timestamps map to `Date` only when lossless. Numeric tokens that round during parsing, exceed the safe-integer range, or lose negative zero through JSON transport produce attributed fixture failures before any SDK call. Invalid representable field values still reach the SDK.

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

## CI activation and validation

[Node SDK v2 compliance](../../../.github/workflows/sdk-compliance-tests-node-v2.yml) is the canonical SDK-owned workflow; there is no separate template to synchronize. It runs both profiles on PRs and pushes to `main` affecting the adapter, SDKs or build inputs, including its own workflow file, and supports manual dispatch. It checks out the actual PR head for pull requests or the triggering commit for push and manual runs, runs the adapter with only `contents: read`, and needs no secrets or registry login.

The workflow pins public multi-platform image digests for harness release `1.7.1` and Node `24.21.0-bookworm-slim` directly in `HARNESS_IMAGE` and `NODE_IMAGE`. Image updates are reviewed workflow changes. Preparation rejects missing or malformed image identities; unavailable images fail during pull/build.

When updating the pins, verify anonymous image access, `linux/amd64` support, the Debian-based Node build tools, the draft2 adapter protocol, and strict `check-report` support. Validate both profiles in GitHub Actions against the released images. Compliance is advisory: assertion, preparation and execution failures do not block the workflow. Raw exit codes and diagnostics remain in the artifacts. A separate reporting job reads those artifacts without checking out or executing the tested code, writes both profiles to the job log and summary, and creates or updates one bot-owned PR comment. The comment shows ✅ passed / ❌ non-passing / ⚠️ not-selected totals without listing successful cases. Expand each failure for its message, assertion code, exact failed-step source and, when matching diagnostics provide them, step text, operation, public getter arguments or wire field, and expected/actual values. Clean specs provenance links to the pinned `PostHog/sdk-specs` commit; otherwise the source remains plain text. Older reports retain their message and step source without inferred values. The run-artifacts link names the exact `node-v2-v0` / `node-v2-v1` artifact and `reports/report.json.diagnostics.json` file; search that file by `case_id` for full diagnostics. Missing or invalid reports are explicitly marked unavailable or incomplete. Diagnostics are size-limited and matched to the report run, profile, case and source before use. Published assertion fields are allowlisted, escaped and bounded; full wire requests are not published. Each profile shows at most 20 failures within a 24,000-byte detail budget, with omitted-case counts; the whole comment is limited to 60,000 UTF-8 bytes with an explicit truncation notice. Push, manual, fork and Dependabot runs retain the summary without posting a comment. A green CI check is not a conformance claim; a human decides whether the reported results are acceptable.

Each matrix job has a 60-minute limit, with 20 minutes for preparation and 35 minutes for the run step (including bounded startup and cleanup), leaving time for artifact upload even after a step timeout. Preparation bounds the harness pull to 3 minutes, the fresh source build to 15 minutes, and build-identity export to 30 seconds. Bash `pipefail` preserves failures through log capture. Artifacts (`node-v2-v0` / `node-v2-v1`, retained for 14 days) are uploaded even after preparation or run failures: selected source and working-tree status, validated image identities, preparation output/exit, successful build identity, wrapper output, raw harness exit, strict report-check exit, reports, diagnostics, and container/cleanup logs where produced. A build failure cannot produce `build.json`; its build output remains in `prepare.log`.

Local script tests use Docker stand-ins to check prerequisite failures, build failures, exit propagation, and private-network lifecycle. They do not validate image availability, Docker builds, migrated fixtures, or hosted fork behavior. Validate those paths separately with the selected released images.

## Focused checks

```sh
POSTHOG_NODE_CONSUMER=/absolute/path/to/consumer \
  node --test compliance/node/v2/*.test.mjs
pnpm exec oxlint --report-unused-disable-directives-severity error compliance/node/v2
pnpm exec oxfmt --check compliance/node/v2 .oxlintrc.json
bash -n compliance/node/v2/prepare-ci.sh compliance/node/v2/run-compliance.sh
# SC2329: cleanup is invoked indirectly by the EXIT trap.
shellcheck --exclude=SC2329 compliance/node/v2/{prepare-ci,run-compliance}.sh
# Docker-free caller checks:
node --test compliance/node/v2/{prepare-ci,run-compliance}.test.mjs
```

Binding tests use public-method spies for exact translations; HTTP tests also exercise real installed packages in both formats/modes. Controlled SDK stand-ins test deadline, cleanup and process failures, not SDK conformance. Caller tests check raw failure exits and private-network lifecycle. Full migrated profiles and current-base comparisons are separate integration gates owned by the harness run.
