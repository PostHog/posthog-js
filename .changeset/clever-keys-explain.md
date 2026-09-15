---
'posthog-js': patch
'@posthog/types': patch
---

Docstrings for `identity_hash` and `setIdentity()` now say the hash is signed with the Secret API key from Support settings, not a project secret API key or a personal API key.
