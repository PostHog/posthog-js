---
'@posthog/core': minor
---

Add the `@posthog/core/capture-v1` entry point, the Capture V1 transport the PostHog SDKs share. It follows semver like the rest of `@posthog/core`, so an installed SDK keeps working with a newer core; `CaptureError`, `CaptureDroppedEvent`, `CaptureErrorParams` and `CaptureEndpoint` are also exported by posthog-node.
