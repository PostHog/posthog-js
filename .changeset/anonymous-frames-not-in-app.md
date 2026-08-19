---
'@posthog/core': patch
'posthog-js': patch
---

Stop counting Chromium `<anonymous>` stack frames (extension-injected, devtools or string-evaluated code) as in-app code.
