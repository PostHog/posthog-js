---
'@posthog/browser': minor
---

Make the client the single extension host: analytics operations move onto the client, group and person helpers move to `@posthog/browser/groups` and `@posthog/browser/person`.

Breaking for 0.4.x users: the `@posthog/browser/analytics` export, `posthog.analytics`, the `analytics: false` option and the `IPostHogInternal` type are removed. Call `capture()`, `identify()`, `register()` and the other analytics methods on the client, configure scheduling and person profiles through the `analytics` option, and type extension hosts as `IPostHog`. See the package README's "Migrating from the analytics extension" section.
