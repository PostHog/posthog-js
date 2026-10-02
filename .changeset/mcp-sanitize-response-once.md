---
'@posthog/mcp': patch
---

Sanitize each tool response once instead of twice, and replace image, audio and binary blocks before the scan, so tool calls with large results cost less CPU.
