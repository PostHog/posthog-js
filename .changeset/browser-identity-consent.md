---
'@posthog/browser': minor
---

Add explicit consent status and clearing, a setup `bootstrap` option, reset options with device-ID replacement and bootstrap, `onSessionId` subscriptions, and opt-in cookie persistence for cross-subdomain identity. `reset()` now also forgets the stored consent choice, as posthog-js does.

Session and window IDs are now UUIDv7, as in posthog-js.
