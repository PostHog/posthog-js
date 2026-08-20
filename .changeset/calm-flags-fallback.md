---
'posthog-node': minor
---

Fall back to remote evaluation when a requested flag is missing from loaded local definitions. This
changes scoped calls that previously omitted the flag without making a request.
