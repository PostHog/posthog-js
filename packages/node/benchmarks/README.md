# Node SDK benchmarks

PR-only, paired measurements of built Node SDKs. The benchmark implementation comes from one checkout and loads each target through its own package entry point in a fresh process. No SDK runtime source is changed by the runner.

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

| Workload                                        | Public path                                        | Measurement                                                     |
| ----------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| Nine single-flag cases                          | `getFeatureFlag`                                   | Elapsed time/op, process CPU/op, estimated allocated bytes/op   |
| All flags: 10, 100, 1,000                       | `getAllFlags`                                      | Same metrics, per complete all-flags call                       |
| Sustained 1,000-flag evaluation                 | Eight overlapping `getAllFlags` calls              | RSS observations, lifetime peak RSS, post-settling heap/RSS     |
| Forty definition refreshes                      | `reloadFeatureFlags`, then validated `getAllFlags` | Memory checkpoints every five refreshes and at the end          |
| Capture: 32-byte and 4,096-byte string property | `capture`                                          | Asynchronous preparation/enqueue time and allocations per event |
| Capture and drain: 10,000 events                | `capture` plus `flush` every 100 events            | Memory under bounded queue/drain load                           |

The mixed flag fixture includes boolean, rollout, variant, person-property, regex, cohort, early/late/no-match, and inactive flags. Sixteen identities have independently calculated expected values. Setup and post-measurement checks validate every identity, including false and variant results. Refresh generations change boolean/cohort outcomes and regex patterns; checks detect a refresh that fetched but failed to replace definitions.

`getFeatureFlag` is currently deprecated but remains a supported public path. Its once-per-process warning occurs during setup, outside timing. This suite measures those named APIs; it does not imply coverage of `evaluateFlags` snapshots or remote evaluation.

### Transport and lifecycle

A deterministic adapter supplied through the public `fetch` option serves `/flags/definitions` and accepts uncompressed v0 `/batch/` requests. Other requests fail validation. Definition bodies are parsed anew on loading and refresh. The adapter keeps delivery counters, not captured event history.

This isolates SDK costs from sockets, server scheduling, and production. It is not an HTTP integration benchmark. Refresh-memory measurements include fixture generation and the current serialized definition body in the process; prior fixture generations are not retained by the adapter. Capture/drain measurements include the adapter's batch parsing, while enqueue-only timing/allocation passes flush and verify delivery after measurement.

Delivered event counts, per-identity counts, and exact payload contents must match the workload; queue overflow, identity redistribution, or payload loss fails validation. Capture calls return `void`, so each batch of 100 calls includes an event-loop turn to complete asynchronous preparation/enqueue work. The enqueue pass does not measure just the synchronous method return, and it does not include its final flush.

Automatic flush timers and flag polling are disabled through public options. Manual refresh and flush use normal SDK lifecycle methods; the runner does not replace internal queues, flag state, or evaluators. Eight overlapping asynchronous evaluations are event-loop concurrency, not eight CPU workers.

## Measurement methods

Each revision/workload/pass/repetition runs in a separate process. Base and head alternate first position between repetitions and never run concurrently. Warmup, correctness checks, and settling precede measurement. Timing, allocation profiling, and memory observation run as separate passes.

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
- `observed_workload_peak_rss`: highest RSS observed at operation checkpoints or immediately after work. This can miss spikes between checkpoints.
- `process_lifetime_peak_rss`: Node's process high-water mark, converted from KiB to bytes. Includes import, fixture setup, correctness checks, and warmup; it is not a workload-only peak.
- `post_settling_process_rss` and `post_settling_heap_used`: after two explicit GC requests separated by event-loop turns.

Refresh runs also retain memory checkpoints after each five measured cycles. Their durations include those explicit collection requests and correctness checks and are not ordinary evaluation timing samples. Post-settling RSS alone does not prove a leak: V8 and the allocator may keep memory resident.

Each worker has a two-minute timeout and a 512 MiB V8 old-space limit. **That is not a 512 MiB process RSS limit.** A confirmed V8 heap exhaustion is recorded as `oom`; an unexplained SIGKILL is `error`, not assumed OOM. Failed workloads have status and diagnostics rather than fabricated zero values. Completed measurements are written after each worker so later failures leave partial evidence. The suite stops after two worker timeouts, after completing the current base/head pair, to reserve CI time for uploading diagnostics.

## Output and CI

`base.json` and `head.json` contain:

- Execution and revision metadata.
- Stable workload IDs, full parameters, and fixture digests.
- Metrics with units, methods, quality, and independent repetition samples.
- Raw pass results, warmup/operation counts, memory checkpoints, correctness counters, and bounded child logs.
- Unsupported metrics and workload failures.

The JSON shape is the pilot producer format (`schema_version: 1`), not yet a finalized cross-SDK contract. Keep measurement semantics explicit when integrating the shared schema and reporter.

The PR workflow builds the merge base and exact PR head with isolated dependencies, then runs this same head-side suite against both. It records target/base/head SHAs separately, uploads results, and links the artifact in the job summary. It requests read-only repository permissions and has no service credentials. Relevant package and dependency changes are detected through the existing affected-package workflow.

A failed correctness check or broken runner fails the job. A performance difference does not: this producer does not calculate regression verdicts. Shared comparison, uncertainty classification, and PR-comment publishing are separate components. Before adding gates, calibrate on the actual Linux CI runner with same-commit pairs; local macOS observations are not a CI noise floor.
