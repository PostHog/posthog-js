---
'@posthog/nuxt': patch
---

Inject the Nitro server chunks before upload, upload only injected directories, upload the public source maps in one step regardless of the deletion mode, and pass the configured release to every source map command.
