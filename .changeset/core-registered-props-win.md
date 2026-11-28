---
'@posthog/core': minor
---

`PostHogCoreBase` lets a registered property replace the SDK's own value of the same name, fills `$lib` and `$lib_version` as a pair after the caller's properties, and lets a registered or caller `$session_id` or `$geoip_disable` win, with a per-call `disableGeoip` winning over a registered `$geoip_disable` and a caller `$geoip_disable` winning over both; `PostHogCore` keeps its behavior
