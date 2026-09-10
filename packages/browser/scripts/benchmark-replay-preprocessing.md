# Repeated mutation preprocessing investigation (#4217)

Baseline: `881c58a8ddd502fde75670890573ae40e01a757c` (#4808), including getter-cache, per-emission serialization-options reuse and pending mirror-root deduplication. This investigation stays synchronous and does not skip mutation records or subtree visits.

## Workloads

```sh
pnpm turbo --filter=posthog-js build
REPLAY_BENCH_PREPROCESSING=1 REPLAY_BENCH_NODES=50000 \
  REPLAY_BENCH_SHAPES=table,flat,deep,shadow REPLAY_BENCH_RUNS=1 \
  REPLAY_BENCH_COMPRESSION=on pnpm --filter posthog-js benchmark:replay
```

Preprocessing mode selects recording-off controls, startup, repeated moves, mixed moves and child removal. Mixed moves add/remove transient children, update an attribute and toggle a row's masking class during the same observer batch. The final row must be masked and carry the final attribute value. Transient private text must not reach the transport. Replay is checked at the trusted-input and phase-completion checkpoints, not just after the final operation.

`REPLAY_BENCH_MOVE_ROUNDS=0,1,5,10` gives **1, 3, 11, 21 append/reinsert operations** respectively. Supply one value per invocation. These are deliberate stress cases, not assumed customer frequencies.

The `deep` shape uses the table rows with `REPLAY_BENCH_DEPTH` nested wrappers (default 32, accepted range 1–128). Row count matches the table shape; the wrappers add that many physical nodes. The flat shape has wide, shallow element/text pairs. Deep-row ownership and wrapper count are checked on replay, including after sibling reversal.

**Existing depth limit:** rrweb's default snapshot depth limit is 50. The fixture adds document/row/cell depth on top of the requested wrappers. Depths 32 and 40 passed. At 128, both baseline and candidate failed startup replay validation with zero rows instead of 48 in a 1k-node fixture. This is existing truncation, not an optimization result. The harness deliberately rejects it; no limit was increased and no correctness check was weakened.

## Separate diagnostics from timings

For exact visit and set-operation counts, build an explicitly instrumented pair of assets:

```sh
node packages/browser/scripts/build-replay-preprocessing-probe.mjs /tmp/preprocessing-probe
REPLAY_BENCH_DIST=/tmp/preprocessing-probe REPLAY_BENCH_PREPROCESSING=1 \
  REPLAY_BENCH_PROFILE=1 REPLAY_BENCH_MOVE_ROUNDS=5 \
  REPLAY_BENCH_NODES=10000 REPLAY_BENCH_SHAPES=table,flat,deep,shadow \
  REPLAY_BENCH_COMPRESSION=on REPLAY_BENCH_RUNS=1 \
  pnpm --filter posthog-js benchmark:replay
```

The helper uses esbuild and an in-memory source transform, without editing production sources or build artifacts. It wraps each buffer's `genAdds`, `processMutation` and working sets, and instruments `deepDelete`. Weak sets count distinct physical nodes. Counters reset per phase and appear as `preprocessingStats`; `preprocessingMs` is a perturbed diagnostic, not a timing comparison.

Both diagnostic core and recorder use unmangled source builds: mixing the source recorder with a production core would break private-property contracts. The helper also handles the existing inline canvas-worker import, but these probes exercise DOM workloads, not canvas recording. Diagnostic artifacts are not release artifacts or substitutes for production compatibility testing.

A manifest identifies these assets, the harness checks it against the loaded probe, and non-profiled use fails immediately. These checks were exercised. **Never compare diagnostic timings to production timings.** For sampled production-bundle attribution, omit `REPLAY_BENCH_DIST`, enable profiling and use `summarize-replay-profile.mjs` with matching intermediate maps. Ordering-mode mirror wrappers are also active in these diagnostic profiles.

### Measured work before the change

10k-node table, compression enabled:

| Moves | `genAdds` visits | Distinct `genAdds` nodes | `deepDelete` visits | Distinct deleted nodes |
| ----- | ---------------- | ------------------------ | ------------------- | ---------------------- |
| 1     | 10,022           | 10,022                   | 0                   | 0                      |
| 3     | 30,066           | 10,022                   | 20,046              | 10,023                 |
| 11    | 110,242          | 10,022                   | 100,230             | 10,023                 |
| 21    | 210,462          | 10,022                   | 200,460             | 10,023                 |

`deepDelete` walks light-DOM children even if they are blocked. `genAdds` respects blocking and also handles shadow children, so their distinct counts need not match. Shadow descendants are not recursively removed from the moved set by `deepDelete`; they already avoid some repeated classification. Applying mirror-root deduplication to this bookkeeping would therefore be an unsafe generalization.

## Candidate

Replace per-node `NodeList.forEach` calls in `genAdds` and `deepDelete` with indexed loops. Preserve the initial list length, read each child from the live list, skip slots removed during recursion, and keep light/shadow traversal and right-to-left depth-first deletion order. No caching of DOM values or masking decisions, no traversal deduplication, no changes to `processRemoves`.

The deterministic regression on a 201-node subtree failed before the change: 4,422 `forEach` calls instead of 201. Afterward, only the unchanged `processRemoves` traversal makes those calls. The moved set remains in the same order. Other focused tests cover live-list appends/removals in light/shadow DOM and deletion order.

**Every diagnostic visit and set-operation count matched before/after at 1, 3, 11 and 21 moves across table, flat, deep and shadow fixtures**, including mixed moves. Only the way children are enumerated changed.

## Unprofiled comparison

Apple M4 Pro, Chromium 136.0.7103.25, approximately 50k nodes, compression on, no CPU throttling. Three alternating baseline/candidate runs per shape; all 24 scenario arms passed. Identical harness source (`116b177c1c28010e9b379ce644dccd4cc698b27dea9ee89d89fbe597b704ff00`) and no concurrent builds, tests or diagnostics.

| Workload               | Median longest task before / after | Median input delay before / after |
| ---------------------- | ---------------------------------- | --------------------------------- |
| Table, 11 moves        | 475 / 375 ms                       | 481.2 / 380.4 ms                  |
| Flat, 11 moves         | 485 / 378 ms                       | 493.4 / 385.7 ms                  |
| Deep (32), 11 moves    | 483 / 395 ms                       | 489.2 / 401.1 ms                  |
| Shadow, 11 moves       | 374 / 314 ms                       | 382.0 / 319.5 ms                  |
| Table, mixed moves     | 460 / 376 ms                       | 467.4 / 382.5 ms                  |
| Flat, mixed moves      | 475 / 389 ms                       | 484.5 / 397.1 ms                  |
| Deep (32), mixed moves | 488 / 398 ms                       | 496.2 / 404.0 ms                  |
| Shadow, mixed moves    | 349 / 298 ms                       | 357.7 / 304.8 ms                  |

Startup was effectively flat: table 119 / 119 ms; deep 122 / 125 ms. Flat child removal was 67 / 67 ms. Other removal fixtures had no task crossing 50 ms, which does not mean no blocking. These local medians are descriptive, not statistical significance or customer guarantees.

Separate production-bundle diagnostic profiles sampled table preprocessing at 305 / 212 ms and deep preprocessing at 327 / 217 ms. These include profiler/mirror-wrapper perturbation and are not exact wall time. Serialization, other emission work and encoding remain substantial. Sampled heap measurements are not true peak or process memory evidence.

Recorder size: **+115 raw bytes, +80 gzip bytes**. SHA256 baseline `9e8222e1012e3f51d1afb677496d8dd66296c6af380fad8ccef2b405e6b5bc1b`, candidate `cc2e258054c110319d605af0dbbb18106d204c0e18c3780cfed6f2417a982c8f`.

## Validation

- 327 recording/accessor tests passed, 2 skipped; six focused traversal tests included.
- Nine masking tests passed across Chromium, Firefox and WebKit.
- SDK/dependency and rrweb builds/typechecks; targeted lint/format, syntax and ES5/ES6 checks.
- Small table/flat/deep/shadow/CSS preprocessing and ordering fixtures passed with compression on/off. Previous churn fixtures (table/deep/shadow) and legacy mode passed with both settings.
- 10k-node table/flat/deep fixtures passed with 4x page-only CPU throttling. Depth-40 one-move fixtures passed with both compression settings.
- An intentionally emptied movement mutation failed the first repeated-move input checkpoint: the fixture remained in the body instead of its expected destination. The temporary probe was removed.
- All accepted benchmark arms reject privacy leaks, duplicate full-snapshot IDs, unexpected recovery snapshots and mutation/attribute drops. The depth-128 failures above remain explicitly excluded, not labeled as passes.

The relevant incident pattern is silent serialization corruption. Style serialization, replay reconstruction code, lazy-load contracts and recording policies are unchanged; real-browser checks cover intermediate ordering, masking, CSS and shadow state. No recording-volume policy change is intended.

This remains a partial #4217 improvement: the 50k-node candidate still blocks for roughly 300–400 ms. Repeated bookkeeping visits, serialization/layout and emission ordering remain; bounding them requires a separate correctness design.

Local evidence: `/tmp/4217-preprocess-{baseline,candidate}-{1,2,3}/`, `before-rounds-*`, `after-rounds-*`, `after-counters`, `native-{before,after}` and their attribution files. Test and negative-probe logs use the same `/tmp/4217-preprocess-` prefix.
