---
'posthog-js': patch
---

Classify SDK-owned persistence keys with an explicit event exposure policy so new internal persistence state must be intentionally marked as event-visible, hidden, or derived.
