---
'posthog-js': patch
---

fix(browser): stop parsing the whole persistence entry on every capture() to refresh Meta identifiers. This made Interaction to Next Paint slower since 1.426.0, most of all on mobile and for projects with many feature flags.
