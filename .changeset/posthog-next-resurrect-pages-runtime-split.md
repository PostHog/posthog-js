---
'@posthog/next': patch
---

Fix `@posthog/next/pages` packaging so the documented Pages Router setup builds without a `server-only` import error.

The `./pages` subpath previously had no per-runtime `exports` conditions, so any module importing from `@posthog/next/pages` (e.g. `pages/_app.tsx`) transitively pulled in `'server-only'` and `posthog-node`. Next.js rejects `'server-only'` from client modules before tree-shaking can drop the unused re-exports, breaking `next build`. The barrel is now split per runtime:

- `browser` → `./dist/pages.client.js` — `PostHogProvider`, `PostHogPageView`
- `edge-light` / `edge` / `worker` → `./dist/pages.edge.js` — `postHogMiddleware`, `PostHogPageView`, `DEFAULT_INGEST_PATH`
- `react-server` / `default` → `./dist/pages.js` — full surface including `getServerSidePostHog` and `getPostHog`

Existing imports (`from '@posthog/next/pages'`) keep working unchanged; the resolver picks the right barrel per runtime.
