---
'@posthog/ai': patch
---

fix(ai): capture OpenAI `service_tier` in `$ai_model_parameters`, preferring the tier reported by the response so PostHog can accurately attribute costs when `auto` resolves to another tier
