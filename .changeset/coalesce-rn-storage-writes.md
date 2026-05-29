---
'posthog-react-native': patch
---

Coalesce React Native storage writes into a short window so a burst of captures no longer re-serializes and rewrites the whole storage blob on every event. Login, logout, opt-in/opt-out, event flush, app background, shutdown, and fatal exceptions still persist synchronously.
