---
'posthog-js': patch
---

fix(conversations): let users start a new conversation while a ticket is still open

The support widget now surfaces the ticket list navigation (and its "New conversation"
button) whenever the user has any ticket, instead of only when they have multiple tickets
or a single resolved one. Previously a user sitting on one open, unresolved ticket was
locked into that conversation with no way to raise a second issue.
