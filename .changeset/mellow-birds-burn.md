---
'posthog-js': patch
---

Stop parsing the persistence entry on every capture() to refresh the Meta $fbc and $fbp identifiers; capture() now compares the stored text and only parses it when a sibling tab or subdomain changed it.
