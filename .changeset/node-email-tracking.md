---
'posthog-node': minor
---

A send with `templateKey` now takes `tracking`, which chooses what PostHog tracks for the email. Without it, PostHog counts opens, leaves the links as they are, and captures engagement events. `tracking: true` turns on opens, clicks and engagement events. `tracking: false` turns them all off. An object such as `{ clicks: true }` or `{ engagement: false }` turns each kind on or off, and a key you leave out keeps its default.

Clicks are off by default because PostHog can't tell whether a link carries a login or password reset token. Turn them on only when the email's links are safe to send through PostHog's click tracking.

`captureEngagement` is deprecated in favor of `tracking: { engagement: false }`. It keeps working, but PostHog refuses a send that sets both.

`tracking` needs PostHog's API support, which is rolling out. Until it reaches your PostHog instance, PostHog refuses a send that sets it. A send without it works as before.
