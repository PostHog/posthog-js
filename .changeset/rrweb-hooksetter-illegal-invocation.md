---
'@posthog/rrweb': patch
'@posthog/rrweb-record': patch
'posthog-js': patch
---

Session recording no longer emits an uncaught `TypeError: Illegal invocation` when a programmatic input-value change happens on an object that is not a genuine native input element (for example a proxy on the element prototype chain). The recorder drops that one replay update instead of throwing.
