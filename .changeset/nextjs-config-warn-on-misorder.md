---
'@posthog/nextjs-config': patch
---

Warn at process exit when `withPostHogConfig` is wrapped by another Next.js config wrapper that drops its function-form return value. Previously this misconfiguration silently disabled source map generation and upload with no logs or errors. Also documents the correct wrapper ordering in the README.
