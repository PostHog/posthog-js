---
'@posthog/next': patch
---

Fix Pages Router server clients to apply request context after async initialization: the Pages Router path of `createPostHog().getPostHog(ctx)` now wraps method calls in `withContext` instead of calling `enterContext`, which does not propagate back to the caller across the helper's await boundary.
