---
'posthog-js': patch
---

Error tracking no longer captures the exception a password-manager autofill content script throws on your page. The script runs in the page world, so the browser stamps its frame with the page URL and the extension URL gate cannot see it. The page-attributed gate now also drops a stack that pairs the autofill function name with the service name in the exception value. A first-party error of the same type on the same page is still captured.
