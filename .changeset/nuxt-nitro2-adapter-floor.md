---
'@posthog/nuxt': patch
---

fix(nuxt): restore the declared Nuxt >= 3.7 floor with a legacy Nitro 2 adapter

The Nitro 2 adapter imports `defineNitroPlugin` and `useRuntimeConfig` from the bare `nitropack/runtime` subpath, which only exists in nitropack >= 2.9.5 — so on Nuxt 3.7–3.11 (which resolve older nitropack) builds emitted unresolved-import warnings and the packed server crashed at startup with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The module now selects a third adapter at build time: Nuxt >= 3.12 (which guarantees nitropack >= 2.9.6) keeps the existing explicit-import adapter, and older Nuxt gets a legacy adapter using the `#imports` virtual module — the same mechanism this module shipped with before the adapter split, which works on every old Nitro 2 version. Verified against Nuxt 3.7.0 + nitropack 2.6.2 and Nuxt 4.5 (including with `nitro: { imports: false }`); the Nitro 3 (Nuxt 5) adapter is unchanged.
