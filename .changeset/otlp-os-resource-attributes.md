---
'posthog-node': minor
'@posthog/core': patch
---

Add `os.name` and `os.version` resource attributes to the spans `posthog-node` sends, so traces can be filtered by platform. `os.name` is the human-readable name the other PostHog SDKs report (`macOS`, `Windows`, `Linux`) rather than the `node:os` identifier. Either key is omitted when the host cannot supply it, and `traces.resourceAttributes` still overrides both.
