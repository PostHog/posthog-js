---
'posthog-js': patch
---

fix: restart session recorder when session rotates externally while idle, preventing "Recording not found" for sessions where analytics events triggered session rotation
