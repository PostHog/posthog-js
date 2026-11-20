---
'@posthog/browser': minor
---

Make the client the single extension host: analytics operations, including the group and person methods, move onto the client.

Breaking for 0.4.x users: the `@posthog/browser/analytics` export, `posthog.analytics`, the `analytics: false` option and the `IPostHogInternal` type are removed. Call `capture()`, `identify()`, `register()` and the other analytics methods on the client, configure scheduling and person profiles through the `analytics` option, and type extension hosts as `IPostHog`. Capture can no longer be left out: both entrypoints, including `/core` with only flags and root `analytics: false`, now send the initial `$pageview` (unless `capturePageview: false`) and `$feature_flag_called` on flag reads. Registered super properties, person-profile enablement and flag and survey caches persisted by 0.4.x are not carried over. See the package README's "Migrating from the analytics extension" section.
