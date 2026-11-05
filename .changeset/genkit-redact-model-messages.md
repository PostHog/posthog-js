---
'@posthog/ai': patch
---

Genkit: redact credentials in model messages, so a credential that a tool returns no longer reaches `$ai_input`.
