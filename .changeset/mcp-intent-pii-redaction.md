---
'@posthog/mcp': patch
---

Automatically redact structured personal identifiers — email addresses, phone numbers, IPv4/IPv6 addresses, Luhn-valid card numbers, and US SSNs — from `$mcp_intent` before it is captured. The intent is agent-narrated free text, so it could previously carry personal data a model read aloud despite the "no personal data" instruction. Redaction is always on, scoped to the intent only (structured tool `arguments` and results are untouched, since the same shapes are often legitimate data there), and best-effort for those well-defined shapes rather than free-form names or addresses. `context: false` and `beforeSend` remain the ways to drop the field entirely.
