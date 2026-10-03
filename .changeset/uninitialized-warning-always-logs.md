---
'@posthog/browser-common': patch
'posthog-js': patch
---

Warn in the console when `capture`, `identify`, `reset`, or `shutdown` run before `init()`, instead of only in debug mode
