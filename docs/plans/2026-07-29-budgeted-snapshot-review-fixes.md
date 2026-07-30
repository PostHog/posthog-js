# Budgeted Snapshot Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make budgeted full snapshots transactional, bounded, and correct for every reviewer-reported lifecycle and node-movement case.

**Architecture:** Give each sliced snapshot an opaque transaction token that owns buffer locks, ID reservation, held events, abort state, and recovery. Successful transactions commit in wire order; failed or over-limit transactions discard partial state and create a synchronous recovery checkpoint.

**Tech Stack:** TypeScript, Jest, Vitest, jsdom, rrweb Replayer, pnpm/Turbo.

---

### Task 1: Pin duplicate serialization for every node kind

**Files:**
- Modify: `packages/rrweb/rrweb-snapshot/test/snapshot-with-budget.test.ts`
- Modify: `packages/rrweb/rrweb-snapshot/src/snapshot.ts`

**Step 1: Write failing tests**

Add table-driven cases that reparent a text node, comment, and blocked element
from an already-visited parent to an unvisited parent during `yieldFn`.
Traverse the returned snapshot and assert each serialized ID occurs once.

**Step 2: Verify failures**

Run:

```bash
pnpm --filter @posthog/rrweb-snapshot test -- snapshot-with-budget.test.ts
```

Expected: each new case reports a duplicate ID.

**Step 3: Fix the guard**

Move:

```ts
serializedThisWalk.add(node)
```

to immediately after the `if (!sn) continue` branch and before appending the
node or making the descend decision.

**Step 4: Verify**

Run the focused snapshot suite and expect all cases to pass.

**Step 5: Commit**

```bash
git add packages/rrweb/rrweb-snapshot/src/snapshot.ts packages/rrweb/rrweb-snapshot/test/snapshot-with-budget.test.ts
git commit -m "fix(rrweb-snapshot): guard every serialized node from duplicates"
```

### Task 2: Introduce owned mutation-buffer transactions

**Files:**
- Modify: `packages/rrweb/rrweb/src/record/mutation.ts`
- Modify: `packages/rrweb/rrweb/src/record/observer.ts`
- Modify: relevant mutation and observer unit tests

**Step 1: Write failing tests**

Cover:

- a buffer created under transaction token A starts locked by A;
- token B cannot commit or discard A;
- discarding A clears pending texts, attributes, removes, adds, movement maps,
  and canvas pending state without invoking `mutationCb`;
- committing A emits normally;
- ending A removes the gate so a later buffer starts unlocked;
- add/remove of an unserialized node changes bookkeeping only while
  transaction-locked.

**Step 2: Verify failures**

Run the focused mutation/observer suites. Expect missing token APIs and the
default-path assertion to fail.

**Step 3: Implement ownership**

Define an opaque numeric `MutationBufferLockToken`. Replace
`newBuffersStartLocked: boolean` with the active token. Add:

```ts
lockMutationBuffers(token)
commitMutationBuffers(token)
discardMutationBuffers(token)
releaseMutationBufferGate(token)
```

`MutationBuffer.lock(token)` records ownership. `commit(token)` unlocks and
emits. `discard(token)` clears pending state and unlocks without emitting.
Mismatched tokens are no-ops.

**Step 4: Preserve default behavior**

In removal processing, cancel a pending add before the unserialized-node bail
only when the buffer has a transaction lock. Leave the budget-zero path in its
original order.

**Step 5: Verify and commit**

Run focused suites, typecheck rrweb, then commit:

```bash
git commit -m "fix(rrweb): give snapshot buffer locks explicit ownership"
```

### Task 3: Build the recorder transaction state machine

**Files:**
- Modify: `packages/rrweb/rrweb/src/record/index.ts`
- Modify: `packages/rrweb/rrweb/src/types.ts`
- Modify: `packages/rrweb/rrweb/test/budgeted-snapshot-convergence.test.ts`

**Step 1: Add controllable failure hooks in tests**

Use the existing snapshot injection seam or add an internal-only recorder test
option that can:

- throw after at least one yield;
- return `null`;
- set low held-event count and byte limits.

Do not expose these hooks through the public PostHog config.

**Step 2: Write failing recorder tests**

Assert:

- a thrown walk emits no held incrementals before recovery;
- a null result follows the same path;
- synchronous recovery emits a valid FullSnapshot before later events;
- all referenced IDs are introduced;
- stop/restart with the second recording using budget zero emits mutations;
- queue overflow performs recovery instead of silently dropping events.

**Step 3: Implement transaction state**

Create a flat internal transaction interface containing token, generation,
start timestamp, queue, estimated bytes, abort flag, commit flag, and queued
checkout. `shouldAbort` checks generation and transaction abort.

Separate:

```ts
commitBudgetedSnapshot(transaction, node)
rollbackBudgetedSnapshot(transaction, error)
recoverSynchronously(transaction)
```

Only commit flushes held events. Rollback discards owned buffers, releases the
owned gate and reservation, resets the partial mirror, then emits a synchronous
checkpoint. A failed recovery invalidates the recording.

**Step 4: Verify**

Run the convergence file alone until every new state-machine case passes.

**Step 5: Commit**

```bash
git commit -m "fix(rrweb): recover budgeted snapshots transactionally"
```

### Task 4: Bound held-event memory

**Files:**
- Modify: `packages/rrweb/rrweb/src/record/index.ts`
- Modify: `packages/rrweb/rrweb/test/budgeted-snapshot-convergence.test.ts`

**Step 1: Write estimator tests**

Cover primitives, strings, arrays, typed arrays, ArrayBuffers, and nested canvas
payloads. Verify the estimator is conservative and cycle-safe.

**Step 2: Add queue high-water tests**

With tiny injected limits, enqueue canvas and input events. Assert the
transaction aborts once, recovers, does not exceed the configured retained
count, and produces a valid wire ledger.

**Step 3: Implement bounds**

Track count and estimated bytes per transaction. When either configured
internal limit is crossed, set the abort flag and stop retaining additional
events. Do not flush a partial queue; rollback owns all cleanup.

**Step 4: Verify and commit**

```bash
git commit -m "fix(rrweb): bound events held during sliced snapshots"
```

### Task 5: Repair CI snapshot and complete adversarial coverage

**Files:**
- Modify: `packages/types/src/__tests__/__snapshots__/config-snapshot.spec.ts.snap`
- Modify: `packages/rrweb/rrweb/test/budgeted-snapshot-convergence.test.ts`

**Step 1: Update only the type snapshot**

Run:

```bash
pnpm --filter @posthog/types test:unit -- -u
```

Inspect that the only snapshot addition is
`fullSnapshotYieldBudgetMs?: number`.

**Step 2: Add wire-level assertions to all new scenarios**

Require unique introduced IDs, no reference before introduction, monotonic
timestamps, and live/replayed DOM convergence where the replayer supports it.

**Step 3: Commit**

```bash
git commit -m "test(rrweb): cover transactional snapshot recovery"
```

### Task 6: Validate correctness and stability

**Files:**
- No source changes expected.

**Step 1: Focused suites**

Run snapshot, mutation/observer, convergence, and types suites.

**Step 2: Complete rrweb suite**

Run:

```bash
pnpm --filter @posthog/rrweb test
pnpm --filter @posthog/rrweb-snapshot test
```

**Step 3: Static checks**

Run package typechecks and lint.

**Step 4: Repeat convergence**

Run the convergence suite at least ten consecutive times. Zero intermittent
failures are accepted.

**Step 5: Default equivalence**

Run the synchronous-versus-budget-zero equivalence tests and inspect wire
snapshots for unintended changes.

### Task 7: Re-run performance experiments

**Files:**
- Modify benchmark notes only if the repository already tracks them.

**Step 1: Baseline**

Use the original large-DOM fixture and record synchronous and 10/25 ms budget
runs with identical node counts and CPU throttle.

**Step 2: Measure**

Capture:

- maximum main-thread task;
- number and p95 of serialization slices;
- total snapshot wall time;
- queue count/byte high-water;
- snapshot node and byte equality;
- recovery overhead in a forced-failure run.

**Step 3: Acceptance**

No duplicate IDs or wire divergence; max serialization slice remains near the
existing bound; total wall time regression is explained and acceptable; normal
runs remain far below queue safety limits.

### Task 8: Final review

**Files:**
- Review every changed file.

**Step 1: Inspect diff**

Run `git diff` against the pre-review commit and `git diff --check`.

**Step 2: Re-check PR status**

Confirm current conflicts with `main`, rebase only after the local fixes are
green, then rerun the focused and CI-equivalent suites.

**Step 3: Prepare reviewer response**

Map each review bullet to its implementation, regression test, and observed
result. Do not push or comment until explicitly requested.
