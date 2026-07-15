---
'@posthog/next': patch
---

Remove the Pages Router `PostHogProvider.bootstrap` prop; move its value to `clientOptions.bootstrap`. For App Router server-evaluated bootstrap, use fresh evaluated flags and payloads while preserving configured identity and session fields.
