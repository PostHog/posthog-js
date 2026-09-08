# Replay main-thread benchmark (#4217)

An **opt-in** benchmark of the built browser SDK, from page work through actual
mocked replay requests. Uses the installed Playwright Chromium (no external sites
or new dependencies). Timing numbers are evidence, not machine-independent CI
thresholds; correctness assertions fail the command.

## Run

From the repository root, using the Node/pnpm versions in the current manifests:

```sh
pnpm install --frozen-lockfile
pnpm turbo --filter=posthog-js build
cd packages/browser
pnpm exec playwright install chromium # if not already installed

# Quick correctness smoke test
REPLAY_BENCH_NODES=1000 REPLAY_BENCH_RUNS=1 pnpm benchmark:replay

# Three runs per size/shape/compression arm (allow ~20 minutes on a desktop)
pnpm benchmark:replay

# Focused comparison / CPU-throttled investigation
REPLAY_BENCH_NODES=50000 REPLAY_BENCH_SHAPES=table REPLAY_BENCH_CPU=4 \
  REPLAY_BENCH_OUTPUT=/tmp/replay-after pnpm benchmark:replay

# Separate profiled run: profiling perturbs timings
REPLAY_BENCH_NODES=50000 REPLAY_BENCH_SHAPES=table REPLAY_BENCH_RUNS=1 \
  REPLAY_BENCH_PROFILE=1 REPLAY_BENCH_OUTPUT=/tmp/replay-profile pnpm benchmark:replay
```

For baseline comparison, save `dist/array.js` and `dist/posthog-recorder.js` from
the baseline build and pass `REPLAY_BENCH_DIST=/absolute/path/to/saved/dist`.
Run the **same benchmark source** against both sets of artifacts. Alternate build
order across repeated comparisons and run without other benchmarks/builds in
parallel. Keep maps alongside artifacts when inspecting `.cpuprofile` files.

Each arm has a fresh browser context/page, but uses the same browser process;
compression-arm order alternates across repetitions. This controls page state,
not all process/JIT/OS caches. Both exact local artifacts are preloaded before
measurement: download and bundle parsing are deliberately **not** recorder CPU.

Results default to ignored `packages/browser/test-results/replay-benchmark/`.
Each completed arm is saved immediately. `results.json` also records the current
checkout SHA/dirty state, **artifact hashes**, browser/Node/platform/CPU, throttle
rate and whether profiling was enabled. The checkout SHA is not proof of a saved
baseline artifact's provenance; keep its source revision with that build.

## Workloads and correctness

- Node-dense rows, like the existing rrweb `test/benchmark/dom-mutation.test.ts`
  workloads: approximately 10k/50k/100k nodes, including **text nodes**. Exact
  serialized full-snapshot counts are reported, not confused with element counts.
- Optional `css` shape: the same rows plus 10k CSSOM-only rules and a constructed
  adopted stylesheet. This deliberately covers the **non-deferrable** CSS bucket,
  not network-loaded/deferred stylesheet performance.
- Recording-off rebuild control, recorder startup, explicit full snapshot,
  subtree rebuild, moving the subtree, and bulk removal. Every rebuild changes
  cell values to expose stale-but-plausible replay output.
- Both `session_recording.compress_events` settings. Outer request compression is
  disabled in **both** arms to isolate rrweb field compression; other SDK buffer,
  encoding and transport work still runs. Request batching is disabled; replay's
  normal flush cadence is retained.
- A custom end marker crosses the actual SDK compression queue and transport.
  Request envelopes and compressed rrweb fields are decoded **in Node**, not on
  the recorded page. The benchmark rejects missing markers, decoding errors,
  duplicate IDs within full snapshots, missing expected snapshots and leaked
  password/text/blocking sentinels.
- After recording stops, the real Replayer rebuilds every recorded checkpoint.
  Assertions cover exact row order, generation-specific text/cell attributes,
  subtree parentage/removal, CSS rule count/boundary selectors and adopted-sheet
  computed padding. Validation happens outside measurement windows.
- Full-snapshot counts, unexpected full snapshots (possible resyncs), add/remove
  counts and per-phase **oversized-mutation and attribute-drop deltas** accompany
  timing results. Raw debug counters remain cumulative. Never accept a faster
  result caused by dropping data or compare runs with different resync behavior.

## Interpreting metrics

- `actionMs`: the synchronous page action only. For rebuilds, MutationObserver
  serialization runs **after** that call; this is not the whole recorder cost.
- `wireMs`: page action start to the request containing its end marker. Includes
  replay's flush delay and encoding, not server ingestion or replay readiness.
- `maxTaskMs` / `longTaskCount`: Long Tasks API entries at/after action start,
  collected through marker delivery plus a 100ms observation drain. **Zero means
  no observed task >=50ms, not zero blocking.** Work is scheduled in a page timer,
  not performed directly inside CDP evaluate (which can hide long tasks).
- `maxFrameGapMs`: largest rAF interval overlapping the action/observation window;
  excludes completed warm-up intervals. This is a responsiveness proxy, **not INP**
  or a measurement of real input dispatch latency.
- `taskCpuMs` / `heapDeltaBytes`: CDP deltas over the wider collection window,
  including measurement setup (50ms), marker waiting and trailing collection.
  They include host DOM/layout/GC and instrumentation work. Compare the recording
  off control; do not label them pure serializer CPU or peak retained memory.
- `wireBytes`: complete replay request body bytes in the phase (encoding and
  envelope included). Counts can span several requests.
- `debug`: existing recorder snapshot/mutation/CSS cost and drop diagnostics.
  The mutation-duration gauge does **not** include `processMutation/genAdds`
  preprocessing; whole-task measurements intentionally include it.

This is the first baseline slice, not the entire #4217 acceptance matrix. It does
not prove exact interaction timing, all mirror-reference dependencies, worker/CSP
fallback, deep DOM/iframes/shadow roots/canvas, periodic rotation, sustained churn,
peak memory, unload delivery or non-Chromium behavior. Keep those covered by their
existing correctness suites and expand this harness when optimizing those paths.
Do not infer general or statistically significant improvements from three desktop
samples, and do not treat a passing final DOM check as complete replay equivalence.
