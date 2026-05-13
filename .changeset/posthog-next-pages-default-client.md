---
'@posthog/next': patch
---

Fix `@posthog/next/pages` default export condition to resolve to the client barrel (`pages.client.js`) instead of the server barrel (`pages.js`), matching the behavior of the root `"."` export. This prevents bundlers that don't match a more specific condition from pulling in `server-only` and `posthog-node` unnecessarily.
