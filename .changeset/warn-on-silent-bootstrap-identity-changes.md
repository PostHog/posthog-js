---
'posthog-js': patch
'@posthog/types': patch
---

Warn when bootstrap changes the identity at init: when `bootstrap.isIdentifiedID` makes `init()` call `identify()`, and when an anonymous bootstrapped ID replaces an already identified user.
