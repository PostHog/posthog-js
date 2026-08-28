---
'posthog-js': patch
'@posthog/browser-common': patch
---

Autocapture no longer throws a `RangeError` into the host page when it sorts element attributes. It now sorts attribute keys with a plain lexical comparator instead of `localeCompare`, which can throw on browsers with faulty ICU data.
