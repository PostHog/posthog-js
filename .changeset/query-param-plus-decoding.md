---
'@posthog/browser-common': patch
'posthog-js': patch
---

Read query params with form-encoding rules: an encoded plus (`%2B`) is kept as `+` instead of becoming a space, and values that contain `=` are no longer cut off. This fixes UTM, click ID and search keyword properties such as `utm_term=c%2B%2B`.
