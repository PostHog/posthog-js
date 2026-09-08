# Remaining replay hotspots after #4811

Baseline: `9e3a6f22553b55bda60422e0631bc672d2be9d99`, stacked on all four prior synchronous improvements. No asynchronous recording, geometry cache or mutation deduplication is introduced here.

## Profiling without mirror wrappers

The benchmark now accepts `REPLAY_BENCH_MIRROR_COUNTERS=0` to disable the existing mirror wrappers while retaining CPU profiling. It also reports CDP `LayoutDuration` and `RecalcStyleDuration` deltas as `layoutCpuMs` and `styleCpuMs`.

```sh
REPLAY_BENCH_PREPROCESSING=1 REPLAY_BENCH_PROFILE=1 \
  REPLAY_BENCH_MIRROR_COUNTERS=0 REPLAY_BENCH_NODES=50000 \
  REPLAY_BENCH_SHAPES=table,flat,deep,shadow REPLAY_BENCH_RUNS=1 \
  REPLAY_BENCH_COMPRESSION=on pnpm --filter posthog-js benchmark:replay
```

Separate `REPLAY_BENCH_LAYOUT_COUNTERS=1` runs wrap `Element.getBoundingClientRect` and report its calls, distinct nodes and elapsed time. These counters require profiling and are never enabled in timing comparisons. The default mirror-counter behavior remains unchanged.

Sampled CPU attribution for 11 moves at approximately 50k nodes, compression on:

| Shape              | Preprocessing | Other emission | Serialization | Encoding |
| ------------------ | ------------- | -------------- | ------------- | -------- |
| Table              | 224 ms        | 37 ms          | 95 ms         | 46 ms    |
| Flat               | 220 ms        | 48 ms          | 100 ms        | 45 ms    |
| Deep (32 wrappers) | 200 ms        | 51 ms          | 101 ms        | 47 ms    |
| Shadow             | 122 ms        | 64 ms          | 85 ms         | 48 ms    |

These are sampled diagnostics, not exact phase wall times. `genAdds`, `deepDelete` and child-list access remain visible hot paths.

## Layout was not a repeated-read opportunity

A separate diagnostic found one rectangle read per repeated-move phase for table/flat/deep and two for shadow, matching the blocked placeholders. The reads took approximately 32, 51, 34 and 38 ms respectively. Recording-off controls made no JS rectangle calls, but still incurred nearly the same browser layout/style work:

| Shape  | Layout + style, recording off | Layout + style, recording on |
| ------ | ----------------------------- | ---------------------------- |
| Table  | 19.2 + 13.6 ms                | 19.3 + 12.5 ms               |
| Flat   | 39.7 + 10.9 ms                | 39.6 + 11.0 ms               |
| Deep   | 19.2 + 15.3 ms                | 19.5 + 14.9 ms               |
| Shadow | 19.1 + 13.4 ms                | 23.5 + 14.6 ms               |

The recorder forces layout earlier, but most of this is also ordinary page layout after the move. It is not evidence of an extra 30–50 ms that can simply be eliminated. No geometry caching was attempted: stale blocked-element dimensions or positions would corrupt replay, and the same element was not repeatedly measured here.

## Small candidate: text-node child-list fast path

After a text node is classified and added to the appropriate set, `genAdds` still fetches its empty child list and checks for a shadow root. `deepDelete` likewise reads an empty list after deleting the text from the set. Valid DOM text nodes cannot have children or shadow roots.

The candidate skips those reads, but deliberately keeps the `isBlocked` call before the `genAdds` fast path. `classMatchesRegex` can use a stateful regular expression, so skipping blocking checks could change later decisions. A regression verifies that a global regexp is still evaluated and its `lastIndex` is updated.

The work-count regression failed before the change with 2,200 text child-list accesses instead of 100. Afterward, only the unchanged `processRemoves` walk accounts for those 100 accesses. Text nodes remain in the moved set and still pass through normal serialization/masking. Diagnostic node visits and set-operation counts match the baseline at 10k nodes / 11 moves across all four shapes, including mixed moves.

## Unprofiled comparison

Apple M4 Pro, Chromium 136.0.7103.25, approximately 50k nodes, compression on, no throttling, three alternating baseline/candidate runs per shape. No concurrent builds/tests/diagnostics. Both builds used harness SHA256 `0ef2f2fcdffa8dbb502ddb1c785de6a51b6d17814277a755024e1a2b35b7caab`. All 24 scenario arms passed replay/input/privacy/drop checks.

| Shape  | Repeated-move longest task | Repeated-move input delay | Mixed-move longest task |
| ------ | -------------------------- | ------------------------- | ----------------------- |
| Table  | 374 / 365 ms               | 379.5 / 370.5 ms          | 370 / 349 ms            |
| Flat   | 380 / 368 ms               | 387.5 / 375.2 ms          | 391 / 366 ms            |
| Deep   | 396 / 388 ms               | 402.5 / 394.0 ms          | 395 / 380 ms            |
| Shadow | 308 / 300 ms               | 315.0 / 305.6 ms          | 302 / 290 ms            |

Values are before / after medians. This is a **smaller, provisional result**: roughly 2–3% on repeated moves and 4–6% on mixed moves. Individual runs overlap, for example table baseline `[374, 365, 385]` versus candidate `[360, 366, 365]`. Three desktop samples do not establish statistical significance or typical customer benefit. Startup and removal were effectively flat. A zero longest-task value in raw results means no task reached 50 ms, not zero blocking.

The recorder increased by 63 raw bytes / 14 gzip bytes. Baseline SHA256: `cc2e258054c110319d605af0dbbb18106d204c0e18c3780cfed6f2417a982c8f`. Candidate: `ccd60e2fb1d540c5564c5b07abd74a94c866b3396132e8122a11125c0b779557`.

## Validation and recommendation

- 329 recording/accessor tests passed, 2 skipped, including two new text-leaf tests and existing light/shadow traversal, masking, mirror and iframe/lifecycle coverage.
- Nine browser masking tests passed across Chromium, Firefox and WebKit.
- Small table/flat/deep/shadow/CSS preprocessing fixtures and table/deep/shadow churn fixtures passed with compression on/off.
- 10k table/flat/deep fixtures passed with 4x page-only throttling and compression on.
- SDK/dependency builds/typechecks, targeted lint/format, syntax and ES5/ES6 checks passed.

The relevant incident risk remains silent serializer corruption. This does not change style serialization, masking rules, node IDs, lazy-load contracts, session rotation or recording-volume policy. Blocking checks, set updates and node visits remain intact. This section records the investigation results; PR closeout review is reported separately.

Keep this as a small follow-up candidate, not another large performance claim. The dominant remaining cost is repeated O(moves × descendants) bookkeeping. Safely reducing those visits needs separate parent/order/cancellation analysis. Geometry caching and async offload are not justified by this investigation. Issue #4217 remains unresolved.

Evidence: `/tmp/4217-hotspots-profile-layout-{0,1}/`, `/tmp/4217-hotspots-attribution.json`, `/tmp/4217-hotspots-{baseline,candidate}-{1,2,3}/`, `/tmp/4217-hotspots-counters/`, and `/tmp/4217-hotspots-*.log`.
