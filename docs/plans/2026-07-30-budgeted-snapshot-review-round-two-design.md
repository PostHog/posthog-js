# Budgeted Snapshot Review Round Two Design

## Context

The second review of PR #4233 found three correctness regressions:

1. `snapshotWithBudget` manually reconstructs the options passed to
   `serializeNodeWithId` and drops `canvasMaskingConfigured`.
2. The default synchronous recorder path ignores a failed full snapshot and
   leaves observers running against a reset mirror.
3. `wrappedEmit` preserves every pre-existing timestamp, changing the default
   handling of cross-origin iframe events and allowing child/parent clock skew
   onto the wire.

The fixes must preserve the pre-PR synchronous behavior while retaining the
explicit timestamp required by a sliced FullSnapshot and its held events.

## Design

### Complete snapshot option propagation

`snapshotWithBudget` will separate only its scheduler controls
(`yieldBudgetMs`, `yieldFn`, and `shouldAbort`) from the normal snapshot
options. The remaining option object will be used as the source for the
per-node serialization options, with only the normalized/internal values
overridden.

`canvasMaskingConfigured` will therefore reach `serializeNodeWithId`, and the
test will compare real synchronous and budgeted output for a masked canvas.
The implementation must avoid fixing only this property while retaining a
second hand-maintained public option list.

### Fatal synchronous snapshot failure

`takeFullSnapshotSynchronous` will remain transactional and return success or
failure. Every caller must handle failure. The normal `takeFullSnapshot`
entrypoint will use the same invalidation behavior already used by budgeted
recovery: advance the recording generation and stop the active recording.

The regression test will throw from real serialization, mutate the DOM
afterward, and assert that no further events are emitted. This validates the
observable recorder lifecycle rather than only the helper's return value.

### Narrow timestamp preservation

`wrappedEmit` will restore the historical behavior of stamping events with the
parent recorder clock. A separate internal emission path will preserve an
explicit timestamp only for recorder-created budgeted Meta/FullSnapshot events
and for events already stamped when they entered the held-event queue.

Cross-origin iframe events will continue through the normal restamping path.
The regression test will inject a deliberately skewed timestamp and prove it
does not survive unchanged.

## Validation

Each blocker gets a regression that must fail against the current PR head
before implementation. After the fix:

- focused regressions pass;
- synchronous/budgeted masked-canvas snapshots match;
- recorder failure leaves no active emission path;
- cross-origin timestamps retain legacy parent-clock semantics;
- TypeScript and rrweb builds pass;
- the 19-scenario budgeted convergence matrix passes;
- the full rrweb and relevant rrweb-snapshot suites pass.

