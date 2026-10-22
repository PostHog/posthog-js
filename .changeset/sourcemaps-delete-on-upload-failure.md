---
'@posthog/webpack-plugin': patch
'@posthog/nextjs-config': patch
---

Delete source maps when processing or uploading them fails while `sourcemaps.deleteAfterUpload` is enabled (the default), so they no longer ship in the build output; set `deleteAfterUpload: false` to keep them.
