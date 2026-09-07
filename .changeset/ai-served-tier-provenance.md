---
'@posthog/ai': patch
---

fix(ai): only record a service tier the provider actually served. The requested `service_tier` no longer leaks into `$ai_model_parameters` from error paths or the LangChain callback, so cost processing cannot price tokens at a tier that was never confirmed. The LangChain callback now merges the served tier langchain surfaces on streamed generations.
