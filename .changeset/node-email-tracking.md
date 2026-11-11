---
'posthog-node': minor
---

A send with `templateKey` now takes `tracking` and `sensitive`.

`tracking` chooses what PostHog tracks for the email. `tracking: true` turns on opens, clicks and engagement events. `tracking: false` turns them all off. An object such as `{ clicks: true }` or `{ engagement: false }` turns each kind on or off, and a key you leave out keeps its default. Without it, PostHog counts opens, captures engagement events, and counts clicks only when the email isn't sensitive.

`sensitive` marks an email that carries login links, reset tokens or codes. A sensitive email keeps its links as they are unless `tracking` turns clicks on, leaves its subject off engagement events, and keeps its content out of PostHog's logs. Without it, a send whose `templateKey` matches a template saved in PostHog follows that template's setting, and any other send is sensitive. A send that sets neither option works exactly as before.

`captureEngagement` is deprecated in favor of `tracking: { engagement: false }`. It keeps working, but PostHog refuses a send that sets both.

`tracking` and `sensitive` need PostHog's API support, which is rolling out. Until it reaches your PostHog instance, PostHog refuses a send that sets either one.
