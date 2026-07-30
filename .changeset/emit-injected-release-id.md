---
'posthog-js': minor
'posthog-node': minor
'@posthog/core': minor
---

Emit the release id that posthog-cli injects into your bundle as `$release_id` on every event, so PostHog can attach exceptions (and any other event) to a release without joining through symbol sets. Adds `getInjectedReleaseId()` to `@posthog/core`. The property is always present, set to `null` when nothing was injected.
