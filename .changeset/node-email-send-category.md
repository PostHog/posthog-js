---
'posthog-node': minor
---

Add an optional `category` option (`MessageCategory` or `TRANSACTIONAL_EMAIL_CATEGORY`) to `posthog.emails.send()` code sends. Active-form declared fields are read once per send by property access, `to` first and `category` last; cross-form and unknown-field validation checks only own enumerable properties (as before), so a template send ignores an inherited or non-enumerable `category`.
