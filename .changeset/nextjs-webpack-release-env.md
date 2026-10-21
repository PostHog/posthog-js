---
'@posthog/nextjs-config': patch
'@posthog/webpack-plugin': patch
---

Prevent stale webpack runtime caches in Next.js by compiling event release IDs before asset hashing.
