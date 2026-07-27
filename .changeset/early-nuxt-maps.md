---
'@posthog/nuxt': patch
---

Delete uploaded public sourcemaps before Nitro generates its asset manifest to prevent stale entries from causing runtime 500 errors.
