---
'posthog-js': patch
'@posthog/types': patch
---

Report a rejected `bootstrap.sessionID` in the console, whatever the debug setting is, and reject an id whose session is already past the 24 hour maximum length. A rejected id starts a second session for the same visit, which was silent before. Also document how `bootstrap.sessionID` and `recordCrossOriginIframes` work together when a visit spans two origins that you control.
