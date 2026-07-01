---
'@posthog/nuxt': patch
---

Skip server sourcemap injection when `ssr: false` so client-only builds still upload their sourcemaps instead of failing on the missing server output (#3005).
