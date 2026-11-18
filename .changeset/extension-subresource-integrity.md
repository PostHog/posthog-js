---
'posthog-js': minor
'@posthog/types': minor
---

Add opt-in `require_subresource_integrity` to verify lazy-loaded extension scripts against SHA-384 hashes built into the trusted SDK bundle; it disables site apps and the toolbar and doesn't cover the initial loader unless pinned, third-party widgets or a malicious release with valid hashes.
