---
'posthog-js': minor
'posthog-node': minor
'@posthog/core': minor
---

Emit the release id that posthog-cli injects into your bundle as `$release_id` on `$exception` events, so PostHog can attach exceptions to a release without joining through symbol sets. Adds `getInjectedReleaseId()` to `@posthog/core`. The property is only attached when an injected release id can be read.
