# Node SDK benchmarks

PR-only, paired measurements of built Node SDKs. The benchmark implementation comes from one checkout and loads each target through its own package entry point in a fresh process. No SDK runtime source is changed by the runner. Suite version 2 implements [SDK benchmark specification v1](https://github.com/PostHog/.github/blob/main/.github/workflows/sdk-benchmark-specification.md) (`suite.specification=sdk-benchmarks/v1`); the result schema remains version 1.

## Run locally

Use Node **24.13.0**, the version pinned by `.github/workflows/node-benchmarks.yml`. Build both checkouts first, each with its own locked dependencies:

```sh
pnpm install --frozen-lockfile --filter posthog-node...
pnpm turbo run build --filter=posthog-node
pnpm --filter posthog-node test:benchmarks
```

From the checkout containing this benchmark suite:

```sh
node packages/node/benchmarks/run.mjs \
  --base /absolute/path/to/base/packages/node \
  --head /absolute/path/to/head/packages/node \
  --output /tmp/node-benchmark-results \
  --repetitions 6
```

Use `--smoke --repetitions 1` to check integration quickly. Smoke results are not suitable for performance conclusions. `--filter flags.all.` selects a workload ID prefix. Point both arguments at the same build to measure run-to-run variation.

The runner does not install dependencies or build targets. Rebuild after changing SDK code; a source commit alone cannot establish which compiled code ran. Results include the target entry path, Node and resolved `@posthog/core` build digests, lockfile digest, SDK commit, dirty state, runtime, benchmark-source digest, and paired-run ID.

## Workloads

The full profile contains 20 workloads. All listed flag evaluation passes use the same operation counts, including allocation sampling.

| Workload ID                                            | Full operations                          | Passes                     |
| ------------------------------------------------------ | ---------------------------------------- | -------------------------- |
| `flags.single.<case>` (nine cases)                     | 16,000, with 10 definitions              | timing, allocation         |
| `flags.all.10`                                         | 1,600                                    | timing, allocation         |
| `flags.all.100`, `flags.all.1000`                      | 160 each                                 | timing, allocation         |
| `flags.load.1000`                                      | 1,600, concurrency 8                     | memory                     |
| `flags.refresh.1000`                                   | 40 refreshes                             | memory                     |
| `capture.enqueue.32`, `capture.enqueue.4096`           | 1,000 events each                        | timing, allocation         |
| `capture.drain.steady.32`, `capture.drain.steady.4096` | 1,000 events each, flush every 100       | timing, allocation, memory |
| `capture.drain.burst.32`, `capture.drain.burst.4096`   | 1,000 events each, flush once at the end | timing, allocation, memory |

Smoke uses 160 single evaluations, 16 all-flags evaluations, 32 load evaluations, four refreshes, and 200 events per capture workload. Steady smoke flushes at 100 and 200; burst smoke flushes only at 200. Capture denominators count capture calls, not flush calls.

The mixed flag fixture includes boolean, rollout, variant, person-property, regex, cohort, early/late/no-match, and inactive flags. Sixteen identities have independently calculated expected values. Setup and post-measurement checks validate every identity, including false and variant results. Every measured flag phase starts at generation 0, restored through the public reload API after verified warmup. Refresh generations 1–40 (1–4 for smoke) change boolean/cohort outcomes and regex patterns. Each refresh must fetch definitions; full correctness sweeps occur before and after measurement, not inside the refresh loop. Controls independently check each changing generation and reject fetched but stale definitions.

`getFeatureFlag` is currently deprecated but remains a supported public path. Its once-per-process warning occurs during setup, outside timing. This suite measures those named APIs; it does not imply coverage of `evaluateFlags` snapshots or remote evaluation.

### Transport and lifecycle

A deterministic adapter supplied through the public `fetch` option serves `/flags/definitions` and accepts uncompressed v0 `/batch/` requests. Other requests fail validation. Definition bodies are parsed anew on loading and refresh. The adapter keeps delivery counters and a preallocated bounded sequence bitmap, not captured event history.

This isolates SDK costs from sockets, server scheduling, and production. It is not an HTTP integration benchmark. Refresh-memory measurements include fixture generation and the current serialized definition body in the process; prior fixture generations are not retained by the adapter. Completed-delivery measurements include capture preparation, serialization, public flush completion and the adapter's parsing and validation overhead. Their `completion_boundary=completed_delivery` verification never flushes again. Enqueue-only timing/allocation passes flush and verify delivery after measurement.

Caller fixtures are constructed before measurement. Event i is named `benchmark`, uses `benchmark-user-<i modulo 16>`, and owns separate properties containing `plan=pro`, integer `sequence=i`, and exactly 32 or 4,096 ASCII `x` payload characters. Previously submitted properties are never mutated by later calls. Receivers require every sequence exactly once with its matching identity, payload and plan; balanced loss/duplication fails even when total and per-user counts match. Delivery order is unrestricted.

Capture calls return `void`, so each group of 100 calls includes an event-loop turn to complete asynchronous preparation/enqueue work. Enqueue reports `completion_boundary=prepared_enqueue`, not synchronous API return, and excludes its final flush. Steady and burst describe the explicit caller flush schedule, not HTTP request counts or a requirement that events remain queued.

Compression, automatic flush timers and flag polling are disabled through public options. The automatic flush count (`flushAt`) is 100,000, queue capacity (`maxQueueSize`) is 100,001, and maximum count-based batch size (`maxBatchSize`) is 100,000. Native size-based transport behavior remains active. Manual refresh and flush use normal SDK lifecycle methods; the runner does not replace internal queues, flag state, or evaluators. Eight overlapping asynchronous evaluations are event-loop concurrency, not eight CPU workers.

## Measurement methods

Each revision/workload/pass/repetition runs in a separate process. Base and head alternate first position between repetitions and never run concurrently. Warmup uses two refreshes, or min(operations, 32) for 1,000-flag evaluations, or min(operations, 160) otherwise. Warmup delivery is fully flushed and verified before capture counters and receiver state reset; the measured sequence restarts at zero independently of warmup count. Flag state resets to generation 0. Correctness checks and settling precede measurement. Timing, allocation profiling, and memory observation run as separate passes.

### Time

- `elapsed_time_per_op`: `process.hrtime.bigint()` around a batch, divided by completed operations.
- `process_cpu_time_per_op`: user plus system CPU from `process.cpuUsage()`, divided by operations.

These include the small benchmark-loop and Promise overhead. They are process measurements, not attribution to individual SDK functions. Do not label elapsed time as CPU utilization.

### Allocations

The V8 sampling heap profiler runs at a 32 KiB average sampling interval, with both `includeObjectsCollectedByMajorGC` and `includeObjectsCollectedByMinorGC` enabled. This is necessary to include temporary allocation churn rather than only objects surviving the pass.

V8's weighted sample sizes are summed and divided by operation count. The resulting metric is explicitly **estimated allocated JavaScript heap bytes/op**. It excludes native allocation coverage not exposed by this profiler and includes benchmark-loop overhead. Low-volume smoke runs can produce very few samples; raw sample counts are retained for diagnosis, not reported as object counts.

Exact `allocations_per_op` is `unsupported`: the protocol does not expose total object allocation count. A sample count is not an allocation count, and heap growth is not cumulative allocation volume.

The measurement-control test allocates and collects approximately 15 MB of array slots. It verifies that the selected profiler settings retain that churn while live-object-only sampling does not. Additional disposable SDK wrappers preserve flag results while adding CPU work and temporary allocations; the worker measurements must detect both. See the [HeapProfiler protocol](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/) for method semantics.

### Memory

- `idle_process_rss`: after definitions, checks, warmup, and settling.
- `observed_workload_peak_rss`: highest RSS observed before work, at operation checkpoints or immediately after work. This can miss spikes between checkpoints.
- `process_lifetime_peak_rss`: Node's process high-water mark, converted from KiB to bytes. Includes import, fixture setup, correctness checks, and warmup; it is not a workload-only peak.
- `post_settling_process_rss` and `post_settling_heap_used`: after two explicit GC requests separated by event-loop turns.

Memory checkpoints occur after each 32 completed load evaluations, every refresh, or each 100 captures, including a final partial group if needed. Positions are unique and increasing. Steady checkpoints follow the scheduled flush; burst checkpoints precede its final flush, with a separate after-work snapshot covering completed delivery. No forced GC runs inside measured work or checkpoint callbacks. Natural GC remains enabled; explicit settling occurs before work and after the after-work snapshot, with final correctness sweeps after the post-settling snapshot. Post-settling RSS alone does not prove a leak: V8 and the allocator may keep memory resident.

Each worker has a two-minute timeout and a 512 MiB V8 old-space limit. **That is not a 512 MiB process RSS limit.** A confirmed V8 heap exhaustion is recorded as `oom`; an unexplained SIGKILL is `error`, not assumed OOM. Failed workloads have status and diagnostics rather than fabricated zero values. Completed measurements are written after each worker so later failures leave partial evidence. The suite stops after two worker timeouts, after completing the current base/head pair, to reserve CI time for uploading diagnostics.

## Output and CI

`base.json` and `head.json` contain:

- Execution and revision metadata.
- Stable workload IDs, full parameters, and fixture digests.
- Metrics with units, methods, quality, and independent repetition samples.
- Raw pass results, warmup/operation counts, memory checkpoints, correctness counters, and bounded child logs.
- Unsupported metrics and workload failures.

The shared `schema_version: 1` contract, semantic validation, comparisons, and rendering live in [PostHog/.github](https://github.com/PostHog/.github/blob/main/.github/workflows/sdk-benchmark-report.md). Runtime-specific measurement methods and quality remain explicit.

The workflow runs for every pull request opened, reopened, or updated in `PostHog/posthog-js`. It builds the merge base and exact PR head with isolated dependencies, then runs this same head-side suite against both. It records target/base/head SHAs separately, renders a validated comparison with the SHA-pinned reporting action in `PostHog/.github`, and uploads raw results and rendered comparison artifacts separately. The job summary includes the report and raw artifact link. It requests read-only repository permissions and has no service credentials.

A failed correctness check or broken runner fails the job. A performance difference does not: this producer does not calculate regression verdicts. Comparisons show descriptive medians and variability, not calibrated regression verdicts. A separate `workflow_run` caller delegates comment publishing to the SHA-pinned reusable workflow in `PostHog/.github`; it verifies run/artifact/PR identities and never executes PR code with write permissions. That caller must land on the default branch before automatic comments are active, including for fork PRs. Before adding gates, calibrate on the actual Linux CI runner with same-commit pairs; local macOS observations are not a CI noise floor.
