---
'@posthog/next': patch
---

Fix Pages Router server clients to apply request context after async initialization: `createPostHog().getServerSidePostHog` now wraps method calls in `withContext` instead of calling `enterContext`, which does not propagate back to the caller across the helper's await boundary.
