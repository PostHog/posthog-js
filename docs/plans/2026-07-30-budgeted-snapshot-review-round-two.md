# Budgeted Snapshot Review Round Two Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve the three correctness blockers from the second PR #4233 review without changing default recorder behavior.

**Architecture:** Preserve one canonical snapshot option object through the budgeted walker, make synchronous full-snapshot failure fatal to its recording session, and narrow explicit timestamp preservation to budgeted transaction events. Validate observable behavior with failing-first recorder and serializer tests.

**Tech Stack:** TypeScript, Vitest, rrweb recorder, rrweb-snapshot, Puppeteer.

---

### Task 1: Pin masked-canvas option loss

**Files:**
- Modify: `packages/rrweb/rrweb-snapshot/test/snapshot-with-budget.test.ts`
- Modify: `packages/rrweb/rrweb-snapshot/src/snapshot.ts`

**Step 1: Write the failing test**

Add a real canvas fixture with `recordCanvas: true` and
`canvasMaskingConfigured: true`. Serialize equivalent documents with
`snapshot()` and `snapshotWithBudget()` and assert deep equality plus the
masked canvas representation.

**Step 2: Run the test to verify it fails**

Run:
`pnpm exec vitest run test/snapshot-with-budget.test.ts -t "canvas masking" --reporter=dot`

Expected: FAIL because the budgeted tree contains unmasked canvas data or
differs from the synchronous tree.

**Step 3: Implement complete option propagation**

Separate scheduler-only options from the snapshot option bag and build
`serializeNodeWithId` options from the remaining canonical object, overriding
only normalized/internal fields such as `maskInputOptions`, `slimDOMOptions`,
`skipChild`, and per-node depth/masking values.

**Step 4: Run the focused test**

Expected: PASS with byte/deep-equivalent output.

**Step 5: Commit**

Commit the regression and implementation together.

### Task 2: Pin synchronous snapshot failure lifecycle

**Files:**
- Modify: `packages/rrweb/rrweb/test/budgeted-snapshot-convergence.test.ts`
- Modify: `packages/rrweb/rrweb/src/record/index.ts`

**Step 1: Write the failing test**

Start the recorder with budget `0` and a `maskTextFn` that throws. After
initialization, mutate and interact with the document. Assert that recording
was invalidated and no post-failure incremental events are emitted.

**Step 2: Run the test to verify it fails**

Run:
`pnpm exec vitest run test/budgeted-snapshot-convergence.test.ts -t "stops after synchronous full snapshot failure" --reporter=dot`

Expected: FAIL because observers remain installed after the mirror reset.

**Step 3: Implement fatal failure handling**

Check the boolean returned by `takeFullSnapshotSynchronous` in the normal
entrypoint. On failure, increment `recordingGeneration` and invoke
`stopRecording`, matching the budgeted recovery failure path.

**Step 4: Run the focused test**

Expected: PASS, with no events after failure.

**Step 5: Commit**

Commit the lifecycle regression and fix.

### Task 3: Restore cross-origin timestamp semantics

**Files:**
- Modify: `packages/rrweb/rrweb/test/record/cross-origin-iframes.test.ts`
- Modify: `packages/rrweb/rrweb/src/record/index.ts`

**Step 1: Write the failing test**

Deliver a transformed cross-origin iframe event carrying a deliberately skewed
child timestamp. Assert that the emitted parent event is restamped rather than
retaining that exact timestamp.

**Step 2: Run the test to verify it fails**

Run:
`pnpm exec vitest run test/record/cross-origin-iframes.test.ts -t "restamps child frame timestamps" --reporter=dot`

Expected: FAIL because `timestamp ??=` preserves the child timestamp.

**Step 3: Implement narrow timestamp preservation**

Restore unconditional parent-clock stamping in the ordinary `wrappedEmit`
path. Add an internal preserve-timestamp path used only by budgeted
Meta/FullSnapshot creation and held-event release.

**Step 4: Run focused timestamp and convergence tests**

Expected: cross-origin regression and budgeted timestamp ordering both pass.

**Step 5: Commit**

Commit the timestamp regression and fix.

### Task 4: Validate the integrated change

**Files:**
- Verify all files changed above.

**Step 1: Run formatting and diff checks**

Run `git diff --check`.

**Step 2: Build rrweb**

Run `pnpm --filter @posthog/rrweb build`.

Expected: TypeScript and Vite build pass.

**Step 3: Run focused suites**

Run the rrweb-snapshot budget suite, cross-origin iframe suite, and synchronous
failure regression.

Expected: all pass.

**Step 4: Run the convergence matrix**

Run:
`pnpm exec vitest run test/budgeted-snapshot-convergence.test.ts --reporter=dot`

Expected: all scenarios pass with monotonic timestamps and valid ID ledger.

**Step 5: Run the full rrweb suite**

Run `pnpm exec vitest run --reporter=dot`.

Expected: all deterministic tests pass; investigate any visual screenshot
flake separately and rerun it in isolation.

**Step 6: Review the final diff**

Confirm default-path changes are limited to restoring historical semantics and
fatal handling of an otherwise unusable recording.
