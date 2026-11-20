---
'@posthog/mcp': patch
---

`PostHogMCP` adds the configured `serverBuild` to `captureAi()` and `captureAiImmediate()` events, as it already does for `capture()` and `captureImmediate()`. With `serverBuild` set, an event whose properties cannot be read is now dropped by the client, as without `serverBuild`, instead of throwing from any of the four methods.
