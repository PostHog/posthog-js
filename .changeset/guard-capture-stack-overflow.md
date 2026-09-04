---
'@posthog/browser-common': patch
'posthog-js': patch
---

Stop a `RangeError: Maximum call stack size exceeded` from escaping the capture path, so exception autocapture cannot recapture it in a loop, and read all campaign params with a single split of the query string.
