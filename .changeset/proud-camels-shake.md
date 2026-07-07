---
'@posthog/next': patch
---

Fix `@posthog/next/pages` in Pages Router server bundles so server APIs like `getServerSideProps` resolve correctly instead of importing the client entrypoint.
