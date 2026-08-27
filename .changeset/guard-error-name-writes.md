---
'posthog-js': patch
'@posthog/core': patch
---

Fix request timeouts never firing on pages where a browser extension makes `Error.prototype.name` non-writable
