---
"posthog-node": patch
---

Simplify local evaluation timestamp tracking by removing unnecessary caching complexity. Local flag evaluation now uses inline Date.now() instead of storing timestamps in an evaluation cache, since evaluation happens synchronously.