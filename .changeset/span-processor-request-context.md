---
'@posthog/ai': minor
---

`PostHogSpanProcessor` accepts a `client` option. When set, each AI span it exports gets the distinct ID, session ID and properties from the context entered with `client.withContext()`, so those spans reach PostHog under the right person on every request. Attributes already on a span are kept.
