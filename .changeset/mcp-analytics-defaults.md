---
'@posthog/mcp': minor
---

Enable model capture and conversation correlation by default. Advertised tool schemas gain an `llm_model` argument (never enforced at dispatch) and eligible tool results gain a conversation handle; `instrument(server, posthog, { captureModel: false, enableConversationId: false })` restores the previous shape. Fresh low-level instances now read both arguments under the ADR-0011 rule instead of staying silent.
