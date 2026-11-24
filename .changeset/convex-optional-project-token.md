---
'@posthog/convex': minor
---

Make `POSTHOG_PROJECT_TOKEN` optional on the component and add a `disabled` option to `PostHog`. This allows Convex deployments (such as dev and preview environments) to start up and run with PostHog disabled when the token isn't set, instead of failing deploy-time validation.
