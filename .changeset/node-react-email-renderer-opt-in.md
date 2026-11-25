---
'posthog-node': minor
---

Stop bundling `@react-email/render` into apps that don't send React emails.

**Breaking for bundled apps that send `react` emails:** if you bundle your app (for example for Cloudflare Workers, Convex, or Vercel Edge) and `@react-email/render` isn't available in `node_modules` at runtime, `emails.send({ react })` now returns a `missing_react_renderer` error and doesn't send the email. Pass the renderer to the client to keep sending: `new PostHog(key, { reactEmailRenderer: await import('@react-email/render') })`. Plain Node apps with `@react-email/render` installed are unaffected.
