---
'posthog-node': minor
---

A send with your own content now takes `trackOpensAndClicks`. Set it to `false` to send the email without open and click tracking: no open pixel and no links rewritten to count clicks, so PostHog can't count that email's opens and clicks. It defaults to `true`, and the SDK leaves it out of the request unless you set it. It is independent of `captureEngagement`, which decides whether engagement events are captured on the recipient's person.

`trackOpensAndClicks` needs PostHog's API support for the field, which is rolling out. Until it reaches your PostHog instance, PostHog refuses a send that sets it.
