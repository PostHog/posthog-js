---
'@posthog/ai': patch
---

fix: extract model from response for OpenAI stored prompts

When using OpenAI stored prompts, the model is defined in the OpenAI dashboard rather than passed in the API request. This change adds a fallback to extract the model from the response object when not provided in kwargs.
