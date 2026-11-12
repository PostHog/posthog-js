---
'@posthog/core': minor
---

Add the `@posthog/core/capture-v1` entry point, the Capture V1 transport the PostHog SDKs share. `CaptureError`, `CaptureDroppedEvent`, `CaptureErrorParams` and `CaptureEndpoint` follow semver because posthog-node exports them; the rest is internal to PostHog SDKs and can change in any release.
