---
'posthog-node': patch
'@posthog/core': patch
---

Declare `evaluation_runtime: "server"` on `/flags` requests from posthog-node and posthog-edge, so the server filters flags by a stated runtime instead of inferring one from the `User-Agent` and browser-ish headers.
