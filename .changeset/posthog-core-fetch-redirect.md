---
'@posthog/core': patch
---

`PostHogFetchOptions` has an optional `redirect` field, so a custom `fetch` sees how capture asks it to handle redirects.
