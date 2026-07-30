---
'@posthog/types': patch
'posthog-js': patch
---

Add `_isIdentified()` to the public `PostHog` interface in `@posthog/types`, so TypeScript users can call it on `window.posthog` and inside the `loaded` config callback, as recommended in https://posthog.com/docs/product-analytics/cutting-costs#only-call-identify-once-per-session
