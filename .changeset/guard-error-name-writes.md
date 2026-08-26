---
'posthog-js': patch
'@posthog/core': patch
---

Guard writes to `error.name` so request timeout detection keeps working in prototype-hardened pages. Some anti-fingerprinting browser extensions make `Error.prototype.name` non-writable, which turned a request timeout into a `TypeError` instead of an `AbortError`. The four timeout and validation errors now set their name through a `createNamedError` helper that catches the failed write.
