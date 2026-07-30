---
'posthog-js': patch
---

Fix `identify()` creating a person profile when the supplied ID already matches an anonymously persisted distinct ID.
