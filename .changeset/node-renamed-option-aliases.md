---
'posthog-node': patch
---

Accept the 5.x option names `before_send`, `custom_blocked_useragents`, `disable_capture_url_hashes`, and `__preview_capture_bot_pageviews` from JavaScript again. Each one maps to its camelCase name and logs one deprecation warning per process. In 6.0.0 they were ignored without a warning, so a `before_send` hook stopped running.
