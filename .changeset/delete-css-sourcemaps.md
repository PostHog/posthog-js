---
"@posthog/webpack-plugin": patch
---

Delete emitted CSS source maps when `deleteAfterUpload` is enabled without uploading CSS assets to PostHog.
