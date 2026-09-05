---
"posthog-js": patch
---

Warn when person processing stays suppressed, and when an identify() ID may not be unique

With the default `person_profiles: 'identified_only'`, PostHog creates no person profile until
`identify()`, a group, or an alias enables person processing. A project that never does one of these
sees healthy events next to an empty persons table, with no explanation from the SDK. The SDK now
prints one console warning after 50 captured events with person processing suppressed, and names the
three ways to change the result.

`identify()` also warns when the ID is short and only letters, such as a first name or a username.
Two users can share such an ID, and PostHog then merges them into one person. The warning does not
block the call.
