---
'@posthog/nuxt': patch
---

fix(nuxt): make the Nitro 2 adapter work on the declared Nuxt >= 3.7 floor

The Nitro 2 adapter imported `defineNitroPlugin` and `useRuntimeConfig` from the bare `nitropack/runtime` subpath, which only exists in nitropack >= 2.9.5 — so on Nuxt 3.7–3.11 (which resolve older nitropack) builds emitted unresolved-import warnings and the packed server crashed at startup with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The adapter now gets `useRuntimeConfig` from Nitro's version-agnostic `#imports` virtual module and exports a typed plain plugin function, so the built runtime no longer depends on nitropack's export map. Verified against Nuxt 3.7.0 + nitropack 2.6.2 and Nuxt 4.5; the Nitro 3 (Nuxt 5) adapter is unchanged.
