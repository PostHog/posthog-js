---
'posthog-js': minor
'@posthog/types': minor
---

Add opt-in `require_subresource_integrity` to verify lazy-loaded extension scripts against SHA-384 hashes built into the trusted SDK bundle (not the initial loader unless pinned, site apps, the toolbar, third-party widgets or a malicious release with valid hashes).
