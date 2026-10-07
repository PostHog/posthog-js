---
'@posthog/mcp': patch
'@posthog/core': patch
---

Sanitize each tool response once instead of twice, and replace image, audio and binary blocks before the scan, so tool calls with large results cost less CPU. Redact PostHog tokens that URL field decoding exposes.
