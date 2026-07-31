---
'posthog-js': patch
'@posthog/browser-common': patch
---

Avoid redacting session replay network bodies when timestamps or UUID fragments resemble social security or credit card numbers.
