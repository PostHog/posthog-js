---
'@posthog/ai': patch
---

Expose `token` in addition to `apiKey` for `PostHogTraceExporter`

We're moving towards a place where we're calling this `token` everywhere. Let's release this as a patch version because it's a tiny change and we still support the old usage. This might be dropped in the next packages/ai major version.
