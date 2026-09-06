# Mirror removal and ordering investigation (#4217)

This slice is based on `c9b2c2216743cd177b2958aee6af7549538ae055` (PR #4807). Both benchmark arms already include the native-getter cache and per-emission serialization-options improvements. No workers, yielding, early dropping or asynchronous recording are introduced.

## Workloads

Run after building the SDK and dependencies:

```sh
# Small correctness matrix, both compression settings
REPLAY_BENCH_ORDERING=1 REPLAY_BENCH_NODES=1000 \
  REPLAY_BENCH_SHAPES=table,flat,shadow,css REPLAY_BENCH_RUNS=1 \
  pnpm --filter posthog-js benchmark:replay

# Timing run; compare the same script against the parent's artifacts using REPLAY_BENCH_DIST
REPLAY_BENCH_ORDERING=1 REPLAY_BENCH_NODES=50000 \
  REPLAY_BENCH_SHAPES=table,flat REPLAY_BENCH_RUNS=3 \
  REPLAY_BENCH_COMPRESSION=on pnpm --filter posthog-js benchmark:replay

# Separate diagnostic run with mirror counters, CPU profiles and sampled JS heap
REPLAY_BENCH_ORDERING=1 REPLAY_BENCH_PROFILE=1 \
  REPLAY_BENCH_NODES=10000 REPLAY_BENCH_SHAPES=table,flat \
  REPLAY_BENCH_RUNS=1 REPLAY_BENCH_COMPRESSION=on \
  pnpm --filter posthog-js benchmark:replay
```

Ordering mode enables the mutation benchmark's input probes and drop/recovery checks, but selects these operations:

- Reverse the row siblings, preserving their values and IDs.
- Move the fixture between two parents repeatedly within one observer batch. `REPLAY_BENCH_MOVE_ROUNDS` defaults to 5 (range 1–20): five round trips plus a final move, **11 moves in total**. This is a deliberate stress case, not a claim about the frequency of this pattern on customer pages.
- Detach the entire fixture as one subtree, then restore it without rebuilding its contents.
- Remove its children individually through one `replaceChildren()` operation.

Matching recording-off controls cover the same operations. Fixtures are restored outside control measurement windows. The `flat` shape uses approximately half as many rows as target nodes: each row is one element plus a text node. At roughly 50k nodes it has 25k direct row siblings, versus about 2.4k in the table shape. Element/attribute mixes differ, so compare baseline/candidate within each shape, not the absolute timings across shapes as a pure structural experiment.

Replay checkpoints now verify forward/reversed row order, fixture absence and restoration, as well as the inherited generation, privacy, CSS and shadow-DOM assertions. A trusted input checkpoint remains part of every phase. A negative probe dropping the reorder mutation failed an intermediate reorder checkpoint as intended, even though later events could repair the final state.

See [benchmark-replay-mutations.md](benchmark-replay-mutations.md) for input-delay, blocking-window, chunked validation and heap-sampling limitations. This remains a Chromium performance harness, not an INP or complete lifecycle test suite.

## Diagnostic counters

Only when **both ordering mode and profiling are enabled**, the benchmark wraps the built recorder's mirror methods in the synthetic page. It counts:

- `removeVisits`: recursive `removeNodeFromMap` calls, including repeated visits.
- `distinctRemovedNodes`: distinct physical DOM nodes visited during the phase, not a count of serialized nodes.
- `removeRoots`: top-level cleanup calls, excluding their recursion.
- Calls to `getId`, `getMeta`, `getNode`, `has`, `hasNode` and `add`.

Counters reset per phase. These wrappers are benchmark-only, are not shipped in SDK artifacts and perturb execution. **Do not use instrumented timings for before/after performance claims.** Method counts can overlap: `getId` calls `getMeta`, so summing them would double-count work. CPU profiles provide further attribution; there is no direct deferred-add queue-scan counter yet.

## Finding and change

The old `mapRemoves` array queued the same root for every removal record. Cleanup then recursively traversed that root's final DOM subtree once per queued entry, before serializing any additions.

For the 10k-node table fixture and 11 moves:

| Diagnostic                      | Parent baseline | Candidate |
| ------------------------------- | --------------: | --------: |
| Cleanup roots processed         |              11 |         1 |
| Recursive node visits           |         110,253 |    10,023 |
| Distinct physical nodes visited |          10,023 |    10,023 |

The candidate uses an insertion-ordered `Set<Node>` for pending cleanup roots. It deletes each root from the queue **before** traversing it, preserving the old consume-before-traversal behavior even if traversal throws. It preserves first-seen root order and still drains cleanup before additions. A later emission can queue the same root again.

This deduplicates **identical queued roots only**. It does not skip arbitrary overlapping parent/child roots, cache DOM contents, change mirror metadata semantics, or alter the emitted removal records. Distinct child roots must still be cleaned separately when they have moved outside an ancestor's final subtree. `Mirror.removeNodeFromMap` itself is unchanged, including shadow-root and iframe-document traversal.

The focused regression failed on the parent with 11 visits to the fixture root instead of one. Tests also preserve mirror IDs across moves and later batches, verify detached descendants are cleaned, and exercise queue consumption and remaining work after a traversal error.

## Local timing results

Apple M4 Pro, Chromium 136.0.7103.25, approximately 50k nodes, compression enabled, no CPU throttling. Three runs per build and shape, with sequential baseline/candidate alternation and the same benchmark source. Every timing run had profiling/counters disabled.

| Shape and workload           | Median longest task before / after | Median input delay before / after |
| ---------------------------- | ---------------------------------- | --------------------------------- |
| Table: 11 moves in one batch | 591 / 471 ms                       | 597.0 / 477.3 ms                  |
| Flat: 11 moves in one batch  | 584 / 476 ms                       | 591.3 / 483.3 ms                  |
| Flat: remove children        | 77 / 67 ms                         | 77.5 / 67.9 ms                    |
| Table: reverse siblings      | 174 / 170 ms                       | 221.5 / 216.7 ms                  |
| Flat: reverse siblings       | 245 / 230 ms                       | 302.6 / 301.0 ms                  |

The recorder artifact increased by 13 raw bytes, with no gzip size increase in this build.

All 12 comparison arms passed intermediate replay/input, privacy and drop/recovery checks. These are descriptive local samples, not significance estimates or customer guarantees. The benefit is strongest for repeated moves, where duplicate traversal was demonstrated. Single-subtree removal was effectively flat. Table restoration was somewhat worse in this sample (154 / 164 ms longest task); flat restoration was flat (191 / 190 ms). Startup is not optimized.

Artifacts:

- `/tmp/4217-mirror-{baseline,candidate}-{1,2,3}/results.json`
- `/tmp/4217-mirror-{before,after}-profile/results.json`
- `/tmp/4217-mirror-negative.log`

## Validation and remaining scope

- 321 recording/accessor tests passed, 2 skipped. This includes the existing iframe, shadow-DOM and recording lifecycle tests.
- Nine masking tests passed across Chromium, Firefox and WebKit.
- SDK/dependency and rrweb builds/typechecks passed, with targeted lint/format and ES5/ES6 checks.
- Small table/flat/shadow/CSS ordering fixtures passed with both compression settings.
- A 10k-node 4x page-throttled table/flat run passed with compression enabled.
- The previous churn workload passed in both compression settings.
- Temporary fault-injection code was removed.

This does not bound main-thread work. The repeated-move candidate still blocks for roughly 470 ms at 50k nodes. Preprocessing still handles each mutation record, and serialization, ordering and layout costs remain. The next investigation can inspect `genAdds`/`deepDelete` work and deferred-add queue scans, but must preserve their parent/order bookkeeping rather than blindly applying the cleanup deduplication rule there.

Incident assessment: mirror cleanup order and snapshot correctness are the relevant risks. Unique roots still drain in order before additions, and existing iframe/shadow lifecycle tests plus real replay checkpoints pass. There are no new lazy-load contracts, persistence fields, sampling, rotation, flush, masking or privacy policies. No recording-volume change is expected. Real low-end-device measurements, broader performance-browser coverage and true peak memory remain open.
