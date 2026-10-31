---
'@posthog/ai': patch
---

`@posthog/ai` now recognizes posthog-node 6 by its `registerOptions` method instead of by `getLibraryVersion()`. A posthog-node 6 client whose version a wrapper or subclass overrides, for example `@posthog/mcp`, no longer sends its AI events to the analytics endpoint. posthog-node 5 clients still use `capture()` unless `enableFullAiCapture` is on.
