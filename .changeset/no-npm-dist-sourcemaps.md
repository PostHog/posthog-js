---
'posthog-js': patch
---

Stop publishing the `dist/*.js.map` source maps to npm. They accounted for 28 MB of the package's 43 MB unpacked size and are never loaded at runtime. The maps are still built and still uploaded to the CDN, so snippet users and the `x_google_ignoreList` console attribution are unaffected.
