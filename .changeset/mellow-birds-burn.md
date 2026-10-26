---
'posthog-js': patch
---

Stop reading cookies and localStorage on every capture() to refresh the Meta $fbc and $fbp identifiers; updates from sibling tabs and subdomains are now adopted from storage events and before writes.
