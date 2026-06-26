---
'@posthog/webpack-plugin': patch
---

Put `dist/config.js` and `dist/config.mjs` back in the published package. 1.5.25 shipped only `config.d.ts`, so `next build` (via `@posthog/nextjs-config`) failed with `Cannot find module './config.js'`. The build now emits config again.
