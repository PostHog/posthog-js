---
'@posthog/browser-common': patch
---

Replace the extension client `apiRequest` bridge with `sendRequest`, exposing the public project token and caller-directed request targets, headers, and browser transports.
