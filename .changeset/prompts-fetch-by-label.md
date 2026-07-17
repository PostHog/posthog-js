---
'@posthog/ai': minor
---

feat(ai): add a `label` option to `Prompts.get()` to fetch the prompt version a label (e.g. `production`) currently points to. Labeled fetches are cached separately, results carry the resolved `label`, and a warning is logged when the server does not resolve the requested label (older PostHog versions ignore the parameter and return the latest version).
