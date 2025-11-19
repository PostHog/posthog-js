---
'posthog-node': minor
---

fix: `fetch` is called without a bound context

This prevents issues in edge runtimes such as Cloudflare
