# Exception Steps Implementation Plan (posthog-js monorepo)

## Goal

Implement **exception steps** for PostHog SDKs, starting with browser SDK wiring, with shared behavior in `@posthog/core` so Node/React can reuse it.

This plan is implementation-ready for a worker agent.

---

## Locked product decisions

These are confirmed and must be implemented as-is:

1. **Buffer semantics:** clear after capture (one-shot behavior).
2. **Event format:** `$exception_steps` entries use **$-prefixed internal keys**.
3. **Config relationship:** exception steps are **independent of autocapture toggles**, and enabled by default for manual `captureException`.
4. **Defaults:**
    - `max_queue_size = 20`
    - `max_bytes = 16384`
5. **Manual override precedence:** if `captureException(..., { $exception_steps: ... })` is provided, **manual wins** (buffered steps are not attached).
6. **Dropped exceptions:** if exception is suppressed/rate-limited/dropped before capture, **keep buffer**.
7. **Reserved key conflicts in `addExceptionStep` properties:**
    - Drop user-provided reserved internal keys.
    - Warn **only in debug mode**.

---

## Expected step payload schema

`$exception_steps` is an array of objects.

Per-step internal fields:

- required: `$message: string`, `$timestamp: string | number` (SDK will emit ISO string)
- optional: `$type: string`, `$level: string`

Custom step fields are allowed (flat or nested JSON values), except reserved key collisions are ignored.

Reserved internal keys:

- `$message`
- `$timestamp`
- `$type`
- `$level`

---

## Architecture split

### Shared behavior in `packages/core` (`@posthog/core`)

Implement shared utilities/classes here:

- Exception step constants and types
- Ring/FIFO buffer manager
- Step normalization/sanitization helpers
- Byte-budget attach algorithm (in-order prefix under `max_bytes`)
- Reserved-key conflict stripping helper

### SDK-specific wiring

- **Browser SDK (`packages/browser`)**:
    - public API method `addExceptionStep(...)`
    - exception event attachment in `PostHogExceptions.sendExceptionEvent(...)`
    - buffer lifecycle integration
- **Node SDK (`packages/node`)**:
    - can adopt shared core behavior in follow-up or same PR if scope allows
    - keep context-scoping concerns SDK-specific

---

## Codebase touchpoints (primary)

### Browser

- `packages/browser/src/posthog-core.ts`
    - add public method `addExceptionStep(message, properties?)`
- `packages/browser/src/posthog-exceptions.ts`
    - own/coordinate buffer
    - attach `$exception_steps` when sending `$exception`
    - clear buffer only when event proceeds to capture path
- `packages/browser/src/extensions/exception-autocapture/index.ts`
    - no major behavior change expected; verify autocapture path uses same send method

### Types / API surface

- `packages/types/src/posthog.ts`
    - add method signature for `addExceptionStep`
- `packages/types/src/posthog-config.ts`
    - extend `ExceptionAutoCaptureConfig` to include nested `exception_steps` config
    - include docs/comments for defaults and semantics
- browser type re-exports as needed (`packages/browser/src/types.ts`)

### Core shared utilities

- `packages/core/src/error-tracking/*` (or nearby shared utils namespace)
    - add new exception-step support files/types/helpers

---

## Config shape to implement

Use nested config under existing `capture_exceptions` object:

```ts
capture_exceptions?: boolean | {
  capture_unhandled_errors?: boolean
  capture_unhandled_rejections?: boolean
  capture_console_errors?: boolean
  exception_steps?: {
    enabled?: boolean         // default true
    max_queue_size?: number   // default 20
    max_bytes?: number        // default 16384
  }
}
```

### Effective behavior rules

- `addExceptionStep` active by default unless `exception_steps.enabled === false`.
- If `capture_exceptions` is `false`, manual `captureException` still works; steps remain independent.
- Missing config values fallback to defaults.

---

## Detailed implementation steps

### 1) Add shared exception-steps core module

Create shared code in `packages/core`:

- `EXCEPTION_STEP_INTERNAL_FIELDS` constants
- `ExceptionStep` type
- `ExceptionStepsConfig` type with defaults helper
- `ExceptionStepsBuffer` class:
    - `add(step)`
    - `drainForException(maxBytes)` OR `getAttachable(maxBytes)` + `clear()`
    - FIFO eviction by `max_queue_size`
- helper to strip reserved keys from user payload + conflict detection metadata
- helper to measure byte size robustly
    - prefer `TextEncoder` when available
    - fallback for environments without `TextEncoder`

### 2) Browser: expose `addExceptionStep`

In `posthog-core.ts`:

- add public method:
    - validates message is non-empty string
    - delegates to `this.exceptions?.addExceptionStep(message, properties)`
- add JSDoc examples and behavior note

### 3) Browser: integrate with `PostHogExceptions`

In `posthog-exceptions.ts`:

- add internal exception-steps manager state
- add method `addExceptionStep(message, properties?)`
    - normalize internal fields
    - drop reserved-key collisions from user payload
    - debug log warning when collisions are dropped
- in `sendExceptionEvent(properties)`:
    1. Run existing suppression checks first.
    2. If dropped by suppression/extension/PostHog guards: return without clearing steps.
    3. If `properties.$exception_steps` exists: send as-is (manual wins), do not auto-attach buffer.
    4. Else attach buffered steps under `$exception_steps` using `max_bytes` budget.
    5. Clear buffer after handing event to `capture(...)` path.

### 4) Extend shared types/config

- update `packages/types` config and interface signatures
- ensure generated refs/snapshots stay consistent

### 5) Validate autocapture path

- confirm autocaptured exceptions get attached steps via shared `sendExceptionEvent` path
- no duplicate attachment

---

## Edge cases / weak spots (must handle)

1. **Event size growth**
    - exception events use `_noTruncate: true`; enforce `max_bytes` strictly for `$exception_steps`.
2. **Serialization hazards**
    - circular refs, functions, BigInt, DOM nodes in step props.
    - ensure safe handling (drop/omit invalid entries, never throw in app runtime).
3. **Ordering guarantee**
    - attached steps remain chronological; no reordering.
4. **Manual override precedence**
    - explicit `$exception_steps` from caller must bypass buffer attach.
5. **Dropped exception behavior**
    - suppression/rate-limit/drop should not clear buffer.
6. **Reserved-key collisions**
    - user-provided reserved keys ignored + debug warning.

---

## Test plan

### Browser tests

1. `addExceptionStep` records step with `$message` + `$timestamp`.
2. Reserved-key collisions are dropped; debug warning appears only in debug mode.
3. FIFO eviction at `max_queue_size`.
4. `captureException` attaches buffered steps when no manual `$exception_steps`.
5. Manual `$exception_steps` fully overrides buffered attach.
6. Buffer clears after successful capture handoff.
7. Buffer is retained when exception is suppressed/dropped.
8. `max_bytes` limits attached steps as in-order prefix.
9. Autocaptured exception includes buffered steps.
10. `exception_steps.enabled=false` disables add/attach behavior.

### Types/tests

- update config snapshot/type tests in `packages/types` as needed.

---

## Suggested task breakdown for worker

1. **Core utilities/types PR commit**
2. **Browser integration + public API commit**
3. **Types/config surface commit**
4. **Tests commit** (browser + types)
5. Run targeted test commands and fix breakages

---

## Validation commands (targeted)

From repo root:

```bash
pnpm turbo --filter=@posthog/core test:unit
pnpm turbo --filter=posthog-js test:unit
pnpm turbo --filter=@posthog/types test:unit
pnpm turbo --filter=posthog-js lint
pnpm turbo --filter=@posthog/core lint
pnpm turbo --filter=@posthog/types lint
```

If snapshots changed in types package, update and re-run tests accordingly.

---

## Non-goals for this task

- No frontend product (posthog app) UI changes in this repo.
- No change to suppression-rule logic semantics.
- No replay timeline rendering changes (that is in `posthog/posthog`, not here).

---

## Acceptance criteria

- `posthog.addExceptionStep(...)` exists and is typed.
- Exception events sent via `captureException`/autocapture can include `$exception_steps` in correct schema.
- Defaults and config behavior match locked decisions.
- Manual `$exception_steps` override works.
- Buffer clear/retain semantics match locked decisions.
- Tests cover key behavior and pass in targeted packages.
