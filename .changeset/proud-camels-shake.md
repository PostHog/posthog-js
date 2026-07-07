---
'@posthog/next': patch
---

Fix `@posthog/next/pages` so Pages Router server bundles resolve the server entrypoint instead of the client barrel. Next.js resolves these bundles with the `node` export condition rather than `react-server`; previously, that fell through to `default`, leaving the server API undefined in `getServerSideProps`. The `node` condition now points to the server barrel, and that import path no longer pulls in `server-only`, which throws outside React Server builds.
