---
'posthog-js': minor
'@posthog/browser-common': minor
'@posthog/types': patch
---

Capture the Snapchat click ID as `sccid` when the landing URL spells it `ScCid` or `SsCid`. When `mask_personal_data_properties` is on, also mask `ScCid`, `SsCid` and `sscid` in captured URLs, including landing URLs stored by older SDK versions.
