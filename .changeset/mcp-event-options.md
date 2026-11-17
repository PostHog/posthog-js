---
'@posthog/mcp': minor
---

Add `eventOptions` to set posthog-node per-event options on MCP events, per call or from an `instrument()` callback. `beforeSend` sees and can change them, and an explicit `process_person_profile` wins over the anonymous default.
