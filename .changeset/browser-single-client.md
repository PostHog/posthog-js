---
'@posthog/browser': minor
---

Make the client the single extension host: analytics operations, including the group and person methods, move onto the client.

Breaking for 0.4.x users: the `@posthog/browser/analytics` export, `posthog.analytics`, the `analytics: false` option and the `IPostHogInternal` type are removed. Call `capture()`, `identify()`, `register()` and the other analytics methods on the client, configure scheduling and person profiles through the `analytics` option, and type extension hosts as `IPostHog`. See the package README's "Migrating from the analytics extension" section.
