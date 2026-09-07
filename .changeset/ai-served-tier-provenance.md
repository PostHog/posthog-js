---
'@posthog/ai': patch
---

fix(ai): only record a service tier the provider actually served. The requested `service_tier` no longer reaches `$ai_model_parameters` from error paths or the LangChain callback, so cost processing cannot price tokens at an unconfirmed tier. The LangChain callback now reads the served tier from the response (message `response_metadata`, `generationInfo`, or `llmOutput`).
