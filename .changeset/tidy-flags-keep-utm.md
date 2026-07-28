---
'@posthog/core': patch
---

Keep session-attribution properties (referrer and `utm_*`/campaign params) on minimal `$feature_flag_called` events. Previously the minimal allowlist stripped every campaign param, so a flag-called event landing first in a session set the whole session's UTM attribution and channel type to NULL in web analytics.
