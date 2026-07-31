---
'posthog-js': minor
'@posthog/rrweb-snapshot': patch
'@posthog/rrweb': patch
'@posthog/rrweb-record': patch
---

Bound the main-thread cost of the recorder's initial full snapshot, and start measuring it.

`stringifyStylesheet` reads `cssText` for every CSSRule of every stylesheet, all inside the one uninterruptible task that takes the full snapshot. On CSS-heavy pages that is the dominant cost, and it has been observed freezing the UI (no rendering, scrolling, or cursor movement) for seconds. The existing `maxDepth` guard doesn't help, since it only bounds deep DOMs, not wide ones or heavy CSS.

Stylesheet inlining now stops after a budget of CSSRules per snapshot (`session_recording.inlineStylesheetBudgetRules`, default 10,000; set `0` for the previous unbounded behaviour). Sheets past the budget are serialized without `_cssText`, keeping `rel`/`href` so replay can load them remotely, and are then inlined one per idle callback and delivered as attribute mutations. Replay fidelity is preserved; the work is just no longer one long blocking task.

The snapshot's cost is also now measured and reported on captured events, so slow snapshots are visible without a browser profile: `$sdk_debug_replay_slowest_full_snapshot_ms`, `$sdk_debug_replay_slowest_full_snapshot_stylesheet_ms`, `$sdk_debug_replay_slowest_full_snapshot_nodes`, `$sdk_debug_replay_slowest_full_snapshot_css_rules`, `$sdk_debug_replay_deferred_stylesheets`, and, for the incremental path, `$sdk_debug_replay_slowest_mutation_batch_ms`.
