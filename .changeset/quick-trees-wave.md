---
'posthog-js': minor
---

Capture the `$device_model` super-property on Android Chromium via `navigator.userAgentData.getHighEntropyValues(['model'])`. Resolved once during init and sent on subsequent events; opt out with `disable_device_model: true`.
