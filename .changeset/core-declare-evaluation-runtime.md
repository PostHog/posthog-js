---
'posthog-node': patch
'@posthog/core': patch
---

Server-side feature flags now resolve in posthog-node and posthog-edge even when a proxy rewrites the request's `User-Agent`. Flags restricted to the `client` runtime now resolve to `undefined` in these SDKs, where a rewritten `User-Agent` previously let them through.
