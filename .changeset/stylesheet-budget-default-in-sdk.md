---
'posthog-js': patch
'@posthog/types': patch
---

Harden the session replay stylesheet inlining budget (`inlineStylesheetBudgetRules`):

- The default budget (10,000 rules) moves from the recorder chunk into posthog-js session recording options, so npm-pinned or cached bundles keep their configured override (including `0` to disable) and direct `rrweb.record()` consumers keep unbounded inlining unless they opt in.
- Deferred inlining is bounded inside a sheet: a resumable cursor stringifies 200 rules per idle slice and emits a sheet's `_cssText` atomically, so monolithic sheets no longer produce one long task and partial CSS never reaches the wire.
- Deferred sheets are flushed synchronously when recording stops and on `pagehide`; residual failure modes are counted via `$sdk_debug_replay_deferred_stylesheets_failed` / `_abandoned`.
- CSSOM-only styles (`insertRule` output, `adoptedStyleSheets`) no longer charge the budget, since deferring `<link>` sheets buys those pages nothing.
- Telemetry fixes: full-snapshot duration wraps the whole synchronous task, deferred counts are cumulative per session, new gauges cover non-deferrable rules and idle stringification cost, and duration samples straddling tab suspension are discarded (`$sdk_debug_replay_discarded_duration_samples`).
