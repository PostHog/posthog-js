---
"@posthog/ai": patch
---

fix(vercel): preserve prototype getter properties when wrapping models

The `withTracing` wrapper now forwards getter properties from the model's prototype chain, fixing compatibility with models like Google Vertex AI that define properties such as `supportedUrls` as prototype getters.
