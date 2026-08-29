---
'posthog-js': patch
'@posthog/browser-common': patch
---

`getElementsChainString` no longer throws a `TypeError` when it receives a non-array value. It now returns an empty string for malformed input instead of calling `.map` on a value that is not an array.
