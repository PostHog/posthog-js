---
'@posthog/nuxt': patch
---

Skip registering the Nitro `posthog-node` client when Nuxt SSR is disabled (`ssr: false`).
