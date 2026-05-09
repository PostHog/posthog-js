---
'@posthog/core': minor
'posthog-node': minor
'@posthog/next': patch
---

Expose UUID and cookie helpers from `@posthog/core` and `posthog-node` for users managing distinct_id outside the browser SDK (e.g. Lambda functions handing out cross-domain redirects). The helpers were already implemented in `@posthog/next` — this change lifts them to core so all SDKs can re-use them. `@posthog/next` now re-exports the same surface from `@posthog/core` to keep existing consumers working without churn. Closes #2143.
