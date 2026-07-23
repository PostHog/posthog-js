---
'@posthog/ai': patch
---

fix(ai): capture OpenAI `service_tier` in `$ai_model_parameters` so PostHog can correctly attribute costs for flex and priority tier requests
