---
'@posthog/mcp': patch
---

`PostHogMCP` adds the configured `serverBuild` to `captureAi()` and `captureAiImmediate()` events, as it already does for `capture()` and `captureImmediate()`.
