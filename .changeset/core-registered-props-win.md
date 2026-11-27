---
'@posthog/core': minor
---

`PostHogCoreBase` lets a registered property replace the SDK's own value of the same name, fills `$lib` and `$lib_version` as a pair after the caller's properties, and lets a registered or caller `$session_id` or `$geoip_disable` win; `PostHogCore` keeps its behavior
