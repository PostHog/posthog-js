---
'posthog-js': patch
---

Bump @posthog/rrweb-* to 0.0.53 — fixes infinite recursion crash ("Maximum call stack size exceeded") when calling posthog.reset() or restarting the recorder on pages with shadow DOM elements (e.g. CometChat)
