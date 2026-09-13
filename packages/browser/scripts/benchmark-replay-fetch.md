# Replay fetch body collection: correctness and opt-in benchmark

This harness loads **shipping `recorder.js` bytes**, runs rrweb with the network plugin, and records emitted plugin events. It does not bundle source or replace the network plugin. It is complementary to `benchmark-replay.mjs` (full replay reconstruction), not a replacement. The companion `session-recording-fetch-compat.spec.ts` checks actual `$snapshot` output and SDK credential-header cleaning, including an old core/new lazy recorder with persisted config and a delayed remote-config response. `session-recording-fetch-lifecycle.spec.ts` checks pending capture across stop, restart, and opt-out.

**The asynchronous latency candidate was rejected, not shipped.** In 54 gated WebKit correctness cases, all 18 candidate cases changed application `response.text()` abort rejection from `AbortError` to `TypeError`; all 18 shipping-baseline and 18 capture-disabled controls retained `AbortError`. Both clone readers and all wrapper orders reproduced it three times. No error rewriting or tee redesign was attempted. Earlier Response delivery cannot justify changing application error semantics.

The retained runtime change is only an independent observer-lifetime guard: pending fetch metadata is discarded after that observer stops, without changing the existing awaited body reads, native arguments, body bounds, or host promise behavior. Its stop/restart regression also fails against the shipping baseline. Normal Playwright tests include a real HTTP after-headers abort regression; no normal CI test expects the rejected optimization.

The opt-in harness retains the rejected experiment's ordering assertions and can compare externally saved unsafe artifacts. Do not infer end-to-end speedup from earlier Response delivery. Run correctness first, then any requested measurements on an otherwise idle machine.

## Harness CLI regression tests

Run `node --test packages/browser/scripts/benchmark-replay-fetch.test.mjs` from the repository root. These opt-in tests need the installed workspace dependencies, but no SDK build or browser binaries. Benchmark and abort repetition counts must be positive safe integers; invalid counts fail before artifact reads or server startup.

## Preserve artifacts first

Use Node 24 and the root's pnpm 11.7.0. In an isolated worktree, export `PREK=0` before `pnpm install --frozen-lockfile` to prevent the root prepare script from reinstalling shared Git hooks, then bootstrap with `pnpm turbo run build --filter=posthog-js`. **Before editing runtime source**, copy `packages/browser/dist` to an external baseline directory, save `git rev-parse HEAD` and SHA-256 hashes of all files, and make the baseline read-only. After edits, build and copy to a _different_ candidate directory with its diff and hashes. Never rebuild in or overwrite the baseline. No worktree needs another worktree's `node_modules` or build outputs.

From the repository root:

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
export PREK=0
export REPLAY_FETCH_BASELINE=/absolute/baseline/dist
export REPLAY_FETCH_CANDIDATE=/absolute/candidate/dist
export REPLAY_FETCH_OUTPUT=/tmp/replay-fetch-guard-correctness
# Retained guard-only code intentionally still awaits body collection.
REPLAY_FETCH_EXPECT_AWAITED=1 node packages/browser/scripts/benchmark-replay-fetch.mjs

# Regression proof: the shipping baseline is EXPECTED to fail only the gate-order assertions.
REPLAY_FETCH_ARM=baseline REPLAY_FETCH_OUTPUT=/tmp/replay-fetch-baseline-correctness \
  node packages/browser/scripts/benchmark-replay-fetch.mjs

REPLAY_FETCH_ARM=disabled REPLAY_FETCH_OUTPUT=/tmp/replay-fetch-disabled-correctness \
  node packages/browser/scripts/benchmark-replay-fetch.mjs

# Reproduce the rejected candidate's abort error (use its saved artifact directory).
REPLAY_FETCH_CASE=abort REPLAY_FETCH_BROWSERS=webkit REPLAY_FETCH_RUNS=3 \
  REPLAY_FETCH_OUTPUT=/tmp/replay-fetch-abort-reproduction \
  node packages/browser/scripts/benchmark-replay-fetch.mjs

# Cancellation characterization/assertions: all three arms, both clone readers.
REPLAY_FETCH_CASE=cancellation REPLAY_FETCH_OUTPUT=/tmp/replay-fetch-cancellation-correctness \
  node packages/browser/scripts/benchmark-replay-fetch.mjs
```

Both installed Playwright Chromium and WebKit run by default. Missing browser binaries are errors, not skipped successes. `REPLAY_FETCH_BROWSERS=chromium` selects one engine for investigation but is not the full safety gate. The local server uses an ephemeral port and requires no external API credentials. Every page/context/browser/server is closed even on failure; withheld responses are released before cancellation completion assertions. Partial raw results survive assertion failures.

## What is asserted

- Real HTTP headers and an initial chunk arrive immediately; a controller withholds the remaining body until after observing native-header delivery and draining the wrapper's promise chain. The rejected proposal required **application fetch settlement to precede release**, not merely beat a millisecond threshold. `REPLAY_FETCH_EXPECT_AWAITED=1` asserts retained baseline/guard ordering instead (the disabled arm always remains nonblocking). WebKit needs the initial chunk to expose this HTTP/1 response. Request-side gates hold only the recorder's cloned reader, proving native dispatch precedes capture completion in both reader modes without requiring WebKit stream uploads.
- Small strings, FormData, Blob, ArrayBuffer, URLSearchParams, Request, Request+init override, prototype accessors, a large body, chunked and delayed bodies, binary exclusion, capture-disabled control, pre-abort and response cancellation. Another wrapper runs both below and above PostHog. It deliberately forwards Request.body to reproduce Safari's original-arguments hazard; Request overloads through that wrapper fail natively too (WebKit `NotSupportedError`, Chromium HTTP/1 streaming upload `TypeError`). The disabled arm verifies these controls; ordinary Request overloads without the adversarial wrapper must succeed. No claim of successful native HTTP/2 streaming upload is made.
- Both buffered and bounded-streaming readers preserve existing behavior. Chunked response rejection is asserted when the browser exposes `Transfer-Encoding` (WebKit hides it). Known-large streaming responses keep the 1 MB placeholder; buffered mode intentionally retains its existing behavior. Every successful capture has complete response data and supported request data, one final network event, and the configured mask hook runs after enrichment. Private body/header sentinels must not appear in emitted plugin events. This harness's mask hook is deliberately explicit; the Playwright compat test separately exercises production SDK credential cleaning on emitted snapshots.
- Existing read/clone-failure unit tests remain unchanged. The retained observer-lifetime guard drops pending captures, including old requests after restart; a fresh observer continues recording. A stop does not abort the application's request. Normal Playwright tests also assert native `AbortError` after a real HTTP response's headers arrive.

## Cancellation caveat (must not be hidden by response-only numbers)

The cancellation fixture exposes each arm's Response, immediately calls `response.body.cancel()`, holds the server body beyond the existing 500 ms read bound, then releases it and checks settlement. It saves event order and times relative to **both fetch invocation and Response delivery**; no exact 500 ms timing assertion is used.

Observed in the controlled correctness run:

- Chromium: cancel settles at Response delivery in both arms/readers.
- WebKit buffered reader: cancellation remains pending until server completion in **both baseline and candidate**. `_tryReadBody` times out without cancelling the buffered clone. This is preexisting retention, not a newly introduced unbounded reader.
- WebKit streaming reader: total fetch-invocation-to-cancel settlement still follows the existing read bound. Baseline delays Response delivery until then; the candidate delivers Response earlier, so the same wait becomes observable _inside the application's cancel await_. Capture-disabled fetch does not have this delay.

Thus the rejected candidate **does not promise native cancellation equivalence**, either. Earlier Response exposure moves a wait into the application's cancel await. This is distinct from the independently confirmed abort-error regression that caused rejection. Do not redesign tees, buffered readers, or Response wrappers just to make a benchmark look better.

## Dedicated uncontended measurement (do not run concurrently with builds)

Only after correctness and when all other workflow builds have settled:

```sh
# Only for the rejected candidate: acknowledge its known abort-contract violations,
# which remain recorded in samples.json, to measure tradeoffs rather than ship it.
REPLAY_FETCH_MODE=benchmark REPLAY_FETCH_ALLOW_UNSAFE_CANDIDATE=1 REPLAY_FETCH_RUNS=30 \
  REPLAY_FETCH_OUTPUT=/tmp/replay-fetch-benchmark \
  node packages/browser/scripts/benchmark-replay-fetch.mjs

REPLAY_FETCH_MODE=benchmark REPLAY_FETCH_CASE=cancellation REPLAY_FETCH_RUNS=30 \
  REPLAY_FETCH_OUTPUT=/tmp/replay-fetch-cancel-benchmark \
  node packages/browser/scripts/benchmark-replay-fetch.mjs
```

For a bounded exploratory measurement after the full correctness matrix has passed, set `REPLAY_FETCH_WRAPPERS=none` and reduce `REPLAY_FETCH_RUNS` (for example, 10 for bodies and 4 for cancellation). The default still tests `none,inner,outer`; the manifest records the selected wrapper orders. At these small sample counts the nearest-rank p95 is the observed maximum, not a reliable population-tail estimate.

The `disabled` arm disables **body and header capture only**; rrweb and network metadata instrumentation still run. It is not a fully disabled recorder or native-fetch overhead baseline.

Each repetition alternates baseline/candidate/disabled arm order, creating fresh contexts for each reader mode and wrapper order. The normal fixture includes a 200 ms delayed-body response with useful application body completion measured separately from headers. The cancellation benchmark uses a shared two-second server-release deadline relative to invocation, **not** relative to each arm's Response delivery. Correctness cancellation runs release after their watchdog instead; those single-run timings are diagnostic, not comparative benchmark results.

Outputs:

- `manifest.json`: Node/platform, mode, repetitions, selected engines/wrappers/case, unsafe-candidate acknowledgement, artifact paths and exact recorder hashes.
- `samples.json`: individual fetch-resolution and useful-body-completion samples; output completeness/byte counts; long tasks where supported; Chromium CDP TaskDuration delta for the whole workload, not just body reads. Cancellation runs include response/cancel times and gate order. Do not interpret unsupported WebKit long-task/CPU metrics as zero overhead.
- `summary.json`: per browser/arm/reader/wrapper/body n, median and p95; aggregate recorder/CPU/long-task summaries and separate cancellation-lifecycle summaries. Correctness runs also save samples for reproduction but are not performance estimates.

Review medians **and tails**, full useful-body/cancel lifecycle, event completeness/privacy, and CPU/long tasks together. The harness does not measure peak retained tee memory, navigation loss, real HTTP/2 upload streaming, arbitrary foreign wrappers, or every previously published core. A statistically repeated speedup cannot waive a correctness blocker. Benchmark mode permits the baseline's expected gate ordering failures. Explicit `REPLAY_FETCH_ALLOW_UNSAFE_CANDIDATE=1` additionally records rather than throws on the rejected candidate's known abort-error violation; baseline/disabled abort violations and all other assertions remain fatal. Never use this acknowledgement for normal correctness or CI acceptance.
