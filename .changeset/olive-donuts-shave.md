---
'posthog-js': patch
'@posthog/types': patch
---

Retry `/flags` in the browser SDK on HTTP 502/504 and on request timeouts, bounded by the new `feature_flag_request_max_retries` config (default 1, set 0 to disable). Plain transport failures are deliberately left to the existing status-zero circuit breaker.
