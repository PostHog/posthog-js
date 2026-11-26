---
'@posthog/ai': patch
---

Genkit telemetry now masks any key ending in a credential word, such as `refresh_token`, `SecretAccessKey`, `oauth_token_secret` or `cookies`, in tool output and model messages, including tool output returned as JSON text. String values in Gemini tool definitions are scanned the same way on every integration, so a URL with `?api_key=` is masked there too.
