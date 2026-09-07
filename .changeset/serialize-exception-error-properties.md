---
'@posthog/browser-common': patch
'posthog-js': patch
---

Preserve Error details, causes, aggregate errors, and custom enumerable properties in event properties, including cross-realm Errors. Apply string truncation to ordinary capture properties and retain custom toJSON serialization for exception additional properties.
