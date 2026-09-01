---
'@posthog/core': patch
---

Drop attributes with an empty key from exported logs and metrics instead of sending them. OTLP requires a non-empty key, and the server stored one verbatim, where it appeared as a nameless attribute that filters could not match.
