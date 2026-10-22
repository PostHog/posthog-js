---
'@posthog/nuxt': patch
---

Delete public source maps when processing or uploading them fails while `sourcemaps.deleteAfterUpload` is enabled (the default), so they no longer ship in the build output; set `deleteAfterUpload: false` to keep them and retry the upload at the end of the build.
