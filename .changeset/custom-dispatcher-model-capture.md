---
'@posthog/mcp': minor
---

Add self-reported model capture to the `PostHogMCP` custom-dispatcher path. `prepareToolList()` injects the opt-in model field, `prepareToolCall()` strips and returns it, and `captureToolCall()` records the model properties.
