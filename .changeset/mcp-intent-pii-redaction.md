---
'@posthog/mcp': patch
---

Reduce personal data in `$mcp_intent`, which is agent-narrated free text and could previously carry personal data a model read aloud.

- Automatically redact structured personal identifiers — email addresses, phone numbers, IPv4/IPv6 addresses, Luhn-valid card numbers, and US SSNs — from `$mcp_intent` before it is captured. Redaction is always on, scoped to the intent only (structured tool `arguments` and results are untouched, since the same shapes are often legitimate data there), and best-effort for those well-defined shapes rather than free-form names or addresses.
- Strengthen the default injected `context` prompt so agents are less likely to write personal data in the first place: the privacy rule is now explicit and lists the identifiers to avoid, and it tells the agent to refer to people and accounts by role ('a user', 'the customer') rather than by identity.

`context: false` and `beforeSend` remain the ways to drop the field entirely.
