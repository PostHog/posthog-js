---
'posthog-js': patch
'@posthog/browser-common': patch
---

Hold the pageviews that happen while a consent banner is still open, and send them with their original time and URL once the user opts in, instead of dropping them
