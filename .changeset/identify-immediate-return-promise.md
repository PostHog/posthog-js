---
"posthog-node": patch
---

Fix `identifyImmediate` to await the underlying network request. Previously the returned promise resolved before the `$identify` event was sent, causing events to be dropped when called from short-lived runtimes (Vercel/Cloudflare Workers, Convex actions) that exit immediately after `await`.
