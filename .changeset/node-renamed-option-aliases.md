---
'posthog-node': patch
---

Accept the 5.x option names `before_send`, `custom_blocked_useragents`, `disable_capture_url_hashes`, and `__preview_capture_bot_pageviews` again as deprecated aliases. Each one maps to its camelCase name and logs one deprecation error per process. When both names are set, the camelCase one wins. In 6.0.0 the old names were ignored without a warning, so a `before_send` hook stopped running.
