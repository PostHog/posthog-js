---
'@posthog/ai': minor
---

Add a Google ADK (`@google/adk`) observability adapter. `@posthog/ai/adk` exposes `PostHogADKPlugin`, an ADK `BasePlugin` that captures a full `$ai_generation` event (input, output, model, token usage, latency, finish reason, trace id, session id, distinct id and groups) for every model call an ADK agent makes, funnelling through the shared `captureAiGeneration` primitive so PostHog derives cost from the model and tokens.
