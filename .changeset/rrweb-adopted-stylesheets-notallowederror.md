---
'@posthog/rrweb': patch
'@posthog/rrweb-record': patch
'posthog-js': patch
---

Session recording no longer emits an uncaught `NotAllowedError` ("Sharing constructed stylesheets in multiple documents is not allowed") when a page assigns a `CSSStyleSheet` constructed in a different document to `adoptedStyleSheets`. That assignment is the host page's own invalid operation, but the recorder's patched setter sat on the call stack, so the exception was attributed to rrweb and churned fingerprints in error tracking. The recorder now contains this specific rejection and skips recording those sheets, while still re-throwing any other native-setter error so host-page behaviour is preserved.
