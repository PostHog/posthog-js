---
'posthog-node': patch
---

A client whose secret key can't read flag definitions, such as a key without the Feature flags: Read scope, now reports one error instead of one on every poll. The error names the missing scope and how to turn off local evaluation. It is reported again after definitions load and the key is rejected later.
