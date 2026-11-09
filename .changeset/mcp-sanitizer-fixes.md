---
'@posthog/core': patch
'@posthog/mcp': patch
---

Fix intent and payload capture bugs: a long digit run no longer drops `$mcp_intent` with a stack overflow (card redaction is otherwise unchanged), captured tool arguments are limited before they are sanitized and credential-named arguments are not walked, and `$mcp_feedback_<name>` object extras redact identifiers in keys and numbers. A parsed `__proto__` argument is still dropped, as before.
