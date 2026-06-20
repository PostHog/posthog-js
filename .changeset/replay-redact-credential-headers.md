---
'posthog-js': patch
---

Session replay network capture: redact credential-bearing headers on both request and response (previously only request), and match credential-shaped custom header names by substring (e.g. `x-gist-encoded-user-token`) in addition to the exact deny list - avoiding accidental capture of tokens/cookies in recordings.
