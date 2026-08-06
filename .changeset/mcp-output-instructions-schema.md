---
'@posthog/mcp': patch
---

Declare an optional `_mcp_instructions` property on the output schema of tools that
advertise one, when `enableConversationId` is on. Inert by itself — it is the schema
declaration that makes a later change able to mirror the conversation handle into
`structuredContent` without failing client-side validation.
