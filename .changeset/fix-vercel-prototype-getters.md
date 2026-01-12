---
"@posthog/ai": patch
---

fix(vercel): preserve prototype getter properties when wrapping models

The `withTracing` wrapper now uses `Object.create` to preserve the entire prototype chain, fixing compatibility with models like Google Vertex AI that define properties such as `supportedUrls` as prototype getters. This approach is more robust than manual property forwarding as it automatically handles properties defined anywhere in the inheritance chain.
