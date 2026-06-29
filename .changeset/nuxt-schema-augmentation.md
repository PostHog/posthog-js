---
'@posthog/nuxt': patch
---

Augment `@nuxt/schema` so `posthogConfig` is a known key on `NuxtConfig`/`NuxtOptions`. Without this, using `posthogConfig` in `nuxt.config.ts` (as the wizard generates) reports a TS2353 error.
