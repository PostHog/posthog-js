---
'posthog-js': patch
---

fix(error-tracking): drop exceptions thrown by the Firefox for iOS `__firefox__` injected global, which is browser code rather than customer code and fingerprints a new issue per page
