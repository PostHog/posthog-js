---
'posthog-js': patch
'@posthog/types': patch
---

fix(browser): refresh configured feature flags when a hidden tab becomes visible

Feature flags now own their automatic refresh timer and visibility listener.
Hidden tabs reload due flags when they become visible. The existing five-minute
default and `remote_config_refresh_interval_ms` behavior remain unchanged.
