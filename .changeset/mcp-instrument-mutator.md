---
'@posthog/mcp': minor
---

Add `instrumentMutator(posthog, options?)` — a point-free `(server) => server` helper for framework server-mutation hooks like `@rekog/mcp-nest`'s `serverMutator`. It instruments the server and returns it, so `serverMutator: instrumentMutator(posthog)` just works (no need to remember that `instrument()` returns the analytics handle, not the server).
