---
'posthog-node': minor
---

Stop bundling `@react-email/render` into apps that don't send React emails. If you bundle your app (for example for Cloudflare Workers or Vercel Edge) and send `react` emails, pass `reactEmailRenderer: await import('@react-email/render')` to the client.
