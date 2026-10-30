---
'@posthog/next': minor
---

feat: add `withPostHogProxy` to capture errors thrown in a Next.js `proxy.ts` or middleware. A failing request waits at most 2 seconds for the capture.
