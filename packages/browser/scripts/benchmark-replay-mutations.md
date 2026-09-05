# Mutation preprocessing investigation (#4217)

Follow-up to PR #4801, based on `e9058295e8b060a9c847bdb4f0872fa144e041be`. This extends the [end-to-end replay benchmark](benchmark-replay.md). It does not implement asynchronous recording or an encoding worker.

## Run

After building the browser SDK and dependencies, run from the repository root:

```sh
# Small correctness matrix, both compression settings
REPLAY_BENCH_MUTATIONS=1 REPLAY_BENCH_NODES=1000 \
  REPLAY_BENCH_SHAPES=table,css,shadow REPLAY_BENCH_RUNS=1 \
  pnpm --filter posthog-js benchmark:replay

# Timing comparison: use the same script against both artifact sets
REPLAY_BENCH_MUTATIONS=1 REPLAY_BENCH_NODES=50000 \
  REPLAY_BENCH_SHAPES=table REPLAY_BENCH_RUNS=3 \
  REPLAY_BENCH_COMPRESSION=on pnpm --filter posthog-js benchmark:replay

# Separate diagnostic run, not a timing comparison
REPLAY_BENCH_MUTATIONS=1 REPLAY_BENCH_NODES=50000 \
  REPLAY_BENCH_SHAPES=table REPLAY_BENCH_RUNS=1 \
  REPLAY_BENCH_COMPRESSION=on REPLAY_BENCH_PROFILE=1 \
  pnpm --filter posthog-js benchmark:replay
node packages/browser/scripts/summarize-replay-profile.mjs \
  packages/browser/test-results/replay-benchmark > /tmp/replay-attribution.json
```

Additional controls:

- `REPLAY_BENCH_MUTATIONS=1`: add nested insertion and sustained churn, matching recording-off controls, and one trusted input probe per phase.
- `REPLAY_BENCH_CHURN_STEPS`: rebuild bursts per churn phase, default 5, range 1–20. Each burst yields through observer delivery, records a checkpoint, and waits 16 ms before the next burst. It does **not** wait for transport between bursts.
- `REPLAY_BENCH_COMPRESSION`: `on`, `off`, or `both` (default).
- `REPLAY_BENCH_SHAPES=shadow`: split the same target row count between light DOM and an open shadow root. Both contain privacy sentinels. This adds constant host/sentinel overhead, not another full copy of the workload. The nested workload connects light-DOM rows before inserting their children; the shadow subtree is populated through `innerHTML`.
- Existing `REPLAY_BENCH_DIST`, `REPLAY_BENCH_OUTPUT`, `REPLAY_BENCH_CPU` and profiling controls still apply.

Do not run benchmark timing comparisons concurrently with builds, tests or other benchmarks.

## Measurement and correctness

Recording-off controls cover rebuild, nested insertion, churn, move and removal. Fixtures are restored outside the control measurement windows and before recording starts. Expected generations are captured explicitly instead of relying on hard-coded phase numbers.

The benchmark schedules work in normal page timer tasks. During each mutation-mode phase, Node submits a trusted CDP click to the activity button. `inputDelayMs` measures from the supplied input timestamp to the button handler, including browser dispatch and main-thread waiting. This is **one synthetic lab input sample per phase**, not INP, a percentile, or a complete interaction latency distribution. The input's actual observed generation gets its own replay checkpoint.

`actionMs` sums synchronous fixture operations; `workloadMs` includes yields, observer processing and the input wait. `totalBlockingMs` sums `max(0, task.duration - 50)` over the observation window. It is a scoped blocking metric, not Lighthouse's navigation TBT. The wider window still includes compression, transport preparation and flush waiting, as described in the baseline documentation.

Every churn generation, trusted input and phase end is checked using the real Replayer. Assertions cover generation-specific content, row order across light/shadow DOM, parentage/removal, and CSS/adopted styles. Privacy checks inspect decoded wire events; full snapshots reject duplicate IDs. Mutation-mode runs fail on observed oversized-mutation drops, throttled-attribute drops or unexpected full snapshots. Faster data loss is not a performance improvement.

Replay validation runs outside measurement, in fresh contexts, with network requests blocked. Event prefixes are uploaded as bounded 1 MiB JSON string chunks: tagged object uploads of large churn histories exceeded Chromium's 100 MB DevTools message limit during harness development. Those failed runs were not accepted as completed comparisons. Per-arm JSON reports remain `validation: "pending"` until all checks pass; aggregate results contain only passed arms.

Profiling runs additionally sample page JS heap usage every 100 ms. `sampledMaxJSHeapUsedBytes` is **not true peak memory**: it can miss transient allocations and excludes native DOM, browser-process and worker memory. These samples perturb execution and are disabled in timing runs. True peak/process memory remains a follow-up.

## Attribution

`summarize-replay-profile.mjs [profile-directory] [browser-dist-directory]` follows the browser bundle source map into intermediate rrweb maps and original sources. Use the **matching build and intermediate maps**, not merely a saved outer `.js.map` with newer rrweb artifacts. It emits sampled self-time and exclusive coarse categories; `mutationInclusiveMs` overlaps those categories and must not be added to them. Sampling is not an exact duration instrument.

A validated baseline 50k-node rebuild profile attributed approximately:

- 39 ms to mutation preprocessing (`processMutation`, `genAdds` and descendants).
- 78 ms to other mutation-emission work, including mirror removal, ordering and allocations.
- 85 ms to serialization, including layout-dependent reads.

These account for roughly 202 ms attributed to mutation code. Encoding and unattributed GC are separate. Preprocessing matters, but it is not the whole stall. Existing added/moved-set guards already skip redundant `genAdds` traversal; removing them or caching live masking decisions is not justified.

## Small synchronous optimization

`MutationBuffer` previously allocated a serialization options object and four callbacks for every serialized node. It now initializes those options lazily once per emission. No cross-emission cache or live DOM values are retained. `serializeNodeWithId` reads, but does not mutate, the options. `needsMask` remains unset, so each node still computes its own masking context.

The deterministic regression test observed 500 distinct options objects for 500 fixture nodes before the change and one afterward. A later batch gets a fresh object. Tests also exercise adjacent masked/unmasked nodes, password masking and changed content across batches.

### Local timing evidence

Apple M4 Pro, Chromium 136.0.7103.25, approximately 50k nodes, compression enabled, no CPU throttling. Three runs per build, ordered baseline/candidate/baseline/candidate/baseline/candidate, with no concurrent benchmark/build work. These are descriptive local medians, not significance estimates or customer guarantees.

| Workload          | Longest task before / after | Input delay before / after |
| ----------------- | --------------------------- | -------------------------- |
| Start recording   | 107 / 114 ms                | 107.7 / 115.0 ms           |
| Full snapshot     | 108 / 108 ms                | 109.0 / 108.7 ms           |
| Rebuild           | 242 / 247 ms                | 247.8 / 253.7 ms           |
| Nested insertion  | 260 / 252 ms                | 265.5 / 259.2 ms           |
| Five churn bursts | 304 / 268 ms                | 303.4 / 274.0 ms           |
| Move subtree      | 260 / 187 ms                | 266.9 / 194.3 ms           |

Total blocking across five churn bursts decreased from 979 to 837 ms. Single rebuild performance was essentially flat/slightly worse; startup and full-snapshot paths are not optimized by this change. Removal produced no observed >=50 ms task in these samples, which is not zero blocking. The recorder artifact increased by 17 raw bytes / 15 gzip bytes.

All six comparison arms passed intermediate replay/input, privacy and drop/recovery checks. Profiling remains separate: individual GC-heavy profiles vary substantially, so do not treat them as proof of a particular GC saving.

Comparison artifacts: `/tmp/4217-mutations-{baseline,candidate}-{1,2,3}/results.json`. Both arms used the same benchmark source. Shadow support, error-handling/reporting refinements and the benchmark-hash field were finalized afterward; subsequent smoke/matrix runs validate those additions.

## Validation and remaining work

- SDK/dependency build, rrweb typecheck/build, targeted lint/format and syntax checks passed.
- 318 recording/accessor tests passed, 2 skipped; browser masking tests passed in Chromium, Firefox and WebKit (9 tests).
- Table, CSSOM/adopted stylesheet and shadow-root small fixtures passed in both compression settings.
- A 10k-node 4x page-throttled run passed in both compression settings.
- 50k-node shadow and 100k-node table runs passed with compression enabled.
- A negative probe discarded the first churn generation from decoded transport. An intermediate churn replay checkpoint failed as intended. The temporary probe was removed.

This does **not** resolve #4217. The single 100k-node candidate run still had 451–618 ms tasks across the large mutation workloads. Deep DOM, iframe/canvas-heavy workloads, realistic input distributions, true peak memory, full performance comparisons across browsers/low-end devices, and prolonged churn/lifecycle behavior remain unproven.

The next investigation should target the remaining serialization/layout and mirror/emission costs. If unavoidable traversal dominates after small optimizations, bounded processing will require an explicit snapshot/mutation consistency design—not silent dropping, skipping masking, or changing event order.

Incident review: this local per-emission change does not alter lazy-load signatures, persisted config, node/mirror IDs, masking policy, queue ordering, sampling, session rotation or unload behavior. No recording-volume change is expected. The ref-only incident matcher sees no uncommitted diff; manual source review and the real-browser checks above are the relevant evidence, not that empty matcher result.
