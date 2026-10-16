---
'posthog-js': patch
'@posthog/rrweb': patch
'@posthog/rrweb-utils': patch
---

Port upstream rrweb [#1652](https://github.com/rrweb-io/rrweb/pull/1652) into the vendored MutationBuffer to fix a 9–10 s session-replay main-thread freeze when a single render mounts many sibling nodes (e.g. a 50 × 35 table at ~13 000 nodes). The pre-fix `addList`-based drain tail-rescanned every pass and ran in O(n²); the new drain iterates `addedSet` in topological order using `dom.previousSibling` / `dom.lastChild` / `dom.nextSibling` and runs in O(n). Fixes [#5227](https://github.com/PostHog/posthog-js/issues/5227).

The walk-up loop treats a `ShadowRoot` parent as its shadow host for ancestry checks so shadow children of a moved host are never serialized before the host itself (fixes the `moved shadow DOM 2` regression caught by @TueHaulund on review). `@posthog/rrweb-utils` picks up three new untainted-prototype accessors (`previousSibling`, `nextSibling`, `lastChild`) that the drain depends on. Nodes that still can't resolve a parent at emission time now emit a `console.warn` matching upstream rrweb's phrasing instead of dropping silently.
