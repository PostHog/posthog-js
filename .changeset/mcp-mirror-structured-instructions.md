---
'@posthog/mcp': patch
---

Mirror the `conversation_id` session handle into `structuredContent` for tools whose
output schema declares `_mcp_instructions`. Clients that read structured results never
saw the handle in `content`, so correlation for those tools was zero.
