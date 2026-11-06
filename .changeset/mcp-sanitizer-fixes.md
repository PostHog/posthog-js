---
'@posthog/core': patch
'@posthog/mcp': patch
---

Fix intent and payload capture bugs: a long digit run no longer drops `$mcp_intent` with a stack overflow, an SSN after a card is redacted whole, `__proto__` keys in tool arguments are kept, captured tool arguments are limited before they are sanitized, and `$mcp_feedback_<name>` JSON extras redact identifiers in keys and numbers.
