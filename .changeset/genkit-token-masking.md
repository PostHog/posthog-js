---
'@posthog/ai': patch
---

Genkit telemetry now masks any key ending in a credential word, such as `refresh_token`, `SecretAccessKey`, `oauth_token_secret` or `cookies`, in tool output and model messages, including tool output returned as JSON text.
