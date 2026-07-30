# Budgeted Snapshot Transaction Design

## Goal

Make time-sliced full snapshots correct under DOM movement, recorder teardown,
serialization failure, and sustained event pressure while preserving the
existing synchronous recorder behavior when
`fullSnapshotYieldBudgetMs` is disabled.

## Invariants

1. A node ID appears at most once in a FullSnapshot.
2. No incremental event is emitted before the FullSnapshot that introduces
   every ID it references.
3. Failure never flushes events or mutations computed against a partial mirror.
4. A recording generation can only release locks and reservations it owns.
5. Stopping or replacing a recording leaves no lock state that can affect the
   next recording.
6. The default synchronous path does not change when the budget is zero.
7. Memory used by held events is bounded.

## Transaction ownership

Each budgeted snapshot gets an opaque transaction token. The token owns:

- the in-flight snapshot state;
- the mutation-buffer lock gate;
- the mirror ID reservation;
- held incremental events;
- a queued follow-up checkout;
- the abort signal used by the walker.

Observer state records the active lock token instead of a global boolean. A
buffer created during a walk starts locked by that token. Unlock and discard
operations require the same token, so an abandoned generation cannot release a
new recording's buffers and cannot leave its own gate armed.

MutationBuffer keeps the token that locked it. Re-locking with the same token is
idempotent. A different token cannot silently steal the lock.

## Successful commit

The walker builds the mirror while all mutation buffers are transaction-locked.
After it returns a complete root:

1. Emit the FullSnapshot.
2. End the transaction's ID reservation.
3. Scrub held events that refer to reservations the snapshot never claimed.
4. Flush held events in observation order.
5. Commit/unlock mutation buffers, which emits mutations against the completed
   mirror.
6. Finish checkout bookkeeping.
7. Release transaction ownership.
8. Start one coalesced follow-up snapshot if requested.

The queue gate remains active during the flush. Deliveries from the flush
bypass it, while checkout requests coalesce into the follow-up transaction.

## Failure rollback and recovery

The transaction records whether a FullSnapshot was emitted. A thrown walker, a
null root, or queue overflow before commit enters rollback:

1. Abort the walker if it is still running.
2. Drop held events without delivering them.
3. End only this transaction's ID reservation.
4. Discard pending mutation-buffer state without invoking mutation callbacks.
5. Release only this transaction's buffer locks.
6. Reset the partial mirror.
7. Take an immediate synchronous FullSnapshot as a recovery checkpoint.
8. Resume normal recording after the recovery snapshot is emitted.

If synchronous recovery also fails, invalidate and stop the recording instead
of emitting a stream with unknown IDs.

A queue overflow is treated as a controlled transaction failure rather than
dropping arbitrary input, click, media, CSSOM, or canvas events.

## Bounded held-event queue

The queue tracks both event count and an estimated retained size. The limits are
internal safety limits, not public configuration. Estimation must avoid
`JSON.stringify` on the hot path; it uses a conservative shallow payload
estimate with special handling for strings, arrays, ArrayBuffers, and canvas
payloads.

Crossing either limit sets the transaction abort flag. The current walker stops
at its next abort check and follows the synchronous recovery path. Tests use
small injected limits; production limits remain high enough not to affect
normal snapshots.

## Serialization guard

`serializedThisWalk` records every successfully serialized node immediately
after `serializeNodeWithId` returns. This includes text nodes, comments, and
blocked-element placeholders. Nodes excluded by slimDOM or whitespace rules
are not recorded because they were not placed in the snapshot.

The convergence suite reparents each affected node kind during a yield and
asserts both unique IDs in the wire snapshot and live/replayed DOM convergence.

## Default-path compatibility

The add-then-remove cancellation behavior needed by a long-held budgeted buffer
is explicitly enabled by the transaction lock. Unlocked mutation processing
keeps the existing early return for unserialized nodes. Unit tests compare
budget-zero behavior with the pre-change contract and separately verify
transaction-locked cancellation.

## Test strategy

Tests are written before implementation and divided by contract:

- snapshot walker: text, comment, and blocked-node reparenting;
- mutation buffer: default behavior versus transaction-locked behavior;
- recorder convergence: thrown walk, null snapshot, stop/restart with budget
  zero, queue overflow recovery, and successful follow-up checkout;
- wire integrity: monotonic timestamps, unique introduced IDs, and no reference
  before introduction;
- CI repair: update the `PostHogConfig` type snapshot;
- stability: run the convergence matrix repeatedly;
- performance: rerun the large-DOM benchmark and compare slice ceiling,
  end-to-end wall time, queue high-water mark, and synchronous recovery cost.

The feature is ready only when the focused tests, complete rrweb suite, type
tests, lint, repeated convergence runs, and benchmark acceptance checks pass.
