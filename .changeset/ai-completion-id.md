---
"@posthog/ai": minor
---

Add `$ai_completion_id`, `$ai_system_fingerprint`, and `$ai_request_id` properties to `$ai_generation` events for OpenAI and Azure OpenAI wrappers. These enable direct correlation between PostHog events and OpenAI's Logs dashboard (`platform.openai.com/logs/{completion_id}`).
