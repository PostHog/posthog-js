---
'posthog-js': patch
---

fix(replay): surface why a trigger-gated session is stuck buffering. Warn when a URL trigger regex appears unexpectedly narrow (e.g. `^https://app.example.com/$`) and name pending V1 and V2 trigger conditions in the buffering diagnostic.
