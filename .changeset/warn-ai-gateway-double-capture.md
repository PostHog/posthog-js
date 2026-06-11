---
"@posthog/ai": minor
---

feat: warn when a `base_url` points at the PostHog AI Gateway. The gateway emits its own `$ai_generation`, so routing through it double-captures (and, for billable products, double-bills) every call. Detection covers the provider wrappers (OpenAI, Azure, Anthropic, Gemini, Vercel), LangChain, OpenAI Agents, direct `captureAiGeneration` callers, and the OTel exporter/processor (via the span's `server.address` / `url.full`). The warning logs on every routed call; the event is left untouched, since it carries data the gateway never sees (groups, custom properties, trace hierarchy).
