---
'posthog-js': patch
---

Stop reporting dead clicks on controls inside open shadow roots (such as web components or micro-frontends) when the click updates content inside the shadow root.
