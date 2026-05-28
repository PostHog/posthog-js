---
'posthog-react-native': patch
---

Coalesce React Native storage writes into a short window so a burst of captures no longer re-serializes and rewrites the whole storage blob on every event. Login, logout, event flush, app background, and shutdown still persist synchronously.
