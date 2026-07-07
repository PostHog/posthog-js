---
'posthog-js': patch
---

Publish the code-split ESM toolbar bundle when the build emits one. The release tooling now recursively includes `dist/toolbar/` (with explicit JS content types for the strict-MIME ESM chunks) across the immutable, major-alias, and compatibility upload prefixes, and the workflow accepts the canonical `toolbar.js`/`toolbar.css` layout. This is a no-op against today's single-file build.
