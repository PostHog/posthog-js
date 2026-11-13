---
'posthog-js': patch
---

fix(replay): split the unload flush into small chunks and flush when the page goes hidden, so short visits keep their recording
