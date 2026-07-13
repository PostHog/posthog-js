---
'posthog-js': patch
---

Handle `sendBeacon` quota rejections instead of silently dropping events. A beacon rejected by the browser (over the page's shared ~64KiB in-flight keepalive quota) is now split in half and re-sent recursively so the batch delivers as far as the quota allows; a rejected payload that cannot be split falls back to a non-keepalive fetch and logs a warning. Previously the boolean return of `sendBeacon` was ignored and an over-quota unload batch was lost with no signal.
