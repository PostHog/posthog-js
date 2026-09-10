---
'@posthog/ai': patch
---

fix(ai): only record a service tier the provider actually served. The requested `service_tier` no longer reaches `$ai_model_parameters` from any capture path — OpenAI error paths, the LangChain callback, and Anthropic events (whose `'auto'`/`'standard_only'` request values were previously recorded) — so cost processing cannot price tokens at an unconfirmed tier. The LangChain callback now reads the served tier from the response (message `response_metadata` or `generationInfo`, depending on the adapter), and OpenAI and LangChain generations additionally emit the served tier as the explicit `$ai_service_tier` event property, which cost processing prices from.
