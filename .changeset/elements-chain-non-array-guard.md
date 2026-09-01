---
'posthog-js': patch
'@posthog/browser-common': patch
---

Harden the directly importable `getElementsChainString` utility against runtime JavaScript callers that pass a non-array value. It now returns an empty string instead of calling `.map` on malformed input.
