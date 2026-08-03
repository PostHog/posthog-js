---
'@posthog/core': patch
'posthog-js': patch
'posthog-node': patch
---

Keep `$referring_domain` and canonical `utm_*`/campaign parameters on minimal `$feature_flag_called` events. Previously the minimal allowlist stripped every campaign parameter, so a flag-called event landing first in a session could set the session's UTM attribution and channel type to NULL in web analytics.
