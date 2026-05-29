---
'@posthog/ai': minor
---

Add `$ai_completion_id` and `$ai_provider_metadata` to `$ai_generation` events for the OpenAI and Azure OpenAI wrappers. `$ai_completion_id` is the provider's response ID (e.g. `chatcmpl-…` / `resp_…`); `$ai_provider_metadata` carries OpenAI-specific fields (`system_fingerprint`, `request_id`). Together they enable correlating PostHog events with OpenAI's Logs dashboard (`platform.openai.com/logs/{completion_id}`). The same options (`completionId`, `providerMetadata`) are now accepted by the public `captureAiGeneration` primitive so other provider wrappers can follow the same pattern.
