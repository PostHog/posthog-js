---
'@posthog/ai': patch
---

fix(ai): wrap `responses.stream()` so `$ai_generation` events are captured for the OpenAI Responses API streaming helper — previously calling `client.responses.stream()` silently bypassed PostHog instrumentation
