# Shadow connectivity investigation after #4812

Base: `f45416053617f752ca05de0dec7439e369e51228`, including all five previous synchronous improvements. Worktree: `posthog-js-4217-connectivity`, branch `perf/replay-dom-connectivity`. This is separate from privacy PR #4815 and does not include its code.

## Candidate

Keep `inDom`'s owner-document guard and its existing `Document.contains` fast path. When containment is false, use a native `Node.isConnected` getter instead of walking shadow hosts and checking containment again. Missing or non-native getters retain the old algorithm.

The optional getter is validated at first use, not just when the Node prototype is first cached. Only the getter function is cached. Every result is read from the current node, with its receiver preserved. This handles a prototype patched before first use and one patched after the native function was cached. It does not cache DOM values, privacy eligibility, geometry or node membership. Queue processing, serialization options, ordering and mirror cleanup are unchanged.

A connection to an element's own Document is not the same as being rendered in the top page. Tests preserve the existing behavior for adopted nodes, detached iframe documents, ordinary fragments, documents themselves and open/closed shadow roots.

## Reproduction and rejected approaches

- The focused work-count test failed on the baseline with 400 containment calls and 700 root lookups for 300 queries involving light and nested-shadow nodes. The candidate uses 300 containment calls and zero root lookups. These are SDK-level call counts, not a claim about the browser's internal algorithm.
- An initial version replaced the common light-DOM path too. Timings were mixed, so it was rejected.
- A getter fast path without native validation dropped incremental recordings when a page patched `Node.prototype.isConnected` to return false. A real Chromium test failed while its unpatched control passed.
- Merely adding the property to the initial prototype validation does not cover patching after that prototype is cached. The final implementation validates the optional getter at first use, falls back for non-native implementations, and retains only a validated function reference. Browser tests cover patching before and after recording starts.
- JSDOM getters are JS implementations. Unit fast-path cases explicitly model their native signature; built-SDK browser tests remain the real-browser oracle.

## Unprofiled timing comparison

Fresh #4812-only rerun: same harness source, sequential builds/runs, alternating baseline/candidate order, five complete samples per build and shape. The fifth candidate arm exceeded the outer command's 600-second limit. That entire partial arm was excluded and rerun in a fresh context; no other benchmark process remained active. About 50k nodes, 11 moves, compression on. Chromium on the local development machine. No invasive counters or concurrent builds/tests ran during these comparisons.

| Shape              | Repeated move longest task, baseline/candidate | Mixed move longest task, baseline/candidate |
| ------------------ | ---------------------------------------------- | ------------------------------------------- |
| table              | 371 / 372 ms                                   | 361 / 369 ms                                |
| flat               | 378 / 379 ms                                   | 366 / 385 ms                                |
| deep (32 wrappers) | 409 / 387 ms                                   | 387 / 384 ms                                |
| shadow             | 303 / 294 ms                                   | 291 / 279 ms                                |

These are descriptive medians, not statistical significance or customer guarantees. The useful signal is shadow-heavy work: roughly 3–4% lower longest tasks in this fresh rerun. All five paired repeated-shadow samples improved; four mixed-shadow pairs improved and one tied. Earlier three-pair measurements suggested about 8%, which this rerun does not support as a stable estimate. Light-DOM results overlap and include regressions, particularly the flat mixed-move median (about 5% slower); do not claim a general speedup. The O(moves × descendants) preprocessing work remains, and #4217 is not resolved.

The final recorder grows from 203908 / 64858 raw/gzip bytes to 204203 / 64944 (+295 / +86).

## Validation

- 337 recording/accessor tests passed, 2 existing skips, including eight new connectivity tests.
- 18 Chromium/Firefox/WebKit cases passed: nine connectivity cases and nine existing masking cases.
- All 40 complete arms of the fresh 50k comparison (plus the earlier 24-arm comparison) passed their intermediate replay, privacy, ordering, drop/recovery and duplicate-ID checks.
- 10k table/flat/deep/shadow smoke passed with compression on and off. A 4x CPU-throttled 10k matrix passed too.
- Build/type checks, targeted lint and ES5/ES6 bundle checks passed.

### Independent privacy fix compatibility

The bare #4812 baseline retains the known held-shadow privacy bug. It must not be described as passing the extended cancellation matrix.

For compatibility validation only, PR #4815 commit `089f90663`'s mutation checks and tests were temporarily overlaid on both the performance baseline and candidate:

- Baseline plus privacy fix: 54 cross-browser blocking cases passed.
- Candidate plus privacy fix: all 72 blocking/connectivity/masking cases passed.
- Candidate plus privacy fix: the retained cancellation harness passed all five shapes, compression off and on, with decoded-wire and intermediate replay assertions.

The overlay was then removed and the standalone performance candidate rebuilt. No #4815 source or test files remain in this worktree. The timing table above does not include the privacy overlay. The benchmark and proposed PR base remain #4812 alone. #4815 is an independent fix, not part of this performance change.

## Evidence

- `/tmp/4217-connectivity-red.log`, `-taint-red.log`
- `/tmp/4217-connectivity-4812-recheck-{baseline,candidate}-{1,2,3,4,5}/results.json` (candidate 5 uses `-5-retry`; exclude the incomplete `-5` directory)
- `/tmp/4217-connectivity-final-{baseline,candidate}-{1,2,3}/results.json` (earlier, not the fresh rerun)
- `/tmp/4217-connectivity-final-record-tests.log`, `-final-browser-tests.log`
- `/tmp/4217-connectivity-final-smoke/`, `-throttled/`
- `/tmp/4217-connectivity-overlay-{baseline-tests,candidate-tests}.log`, `-overlay-cancellation/`
- `/tmp/4217-connectivity-restored-build.log`

Baseline recorder SHA256: `ccd60e2fb1d540c5564c5b07abd74a94c866b3396132e8122a11125c0b779557`.

Candidate recorder SHA256: `5a020b6298d6dbbb8ce7d4ab0145062145a822e77ea0b65d7803b9ce16119df5`.
