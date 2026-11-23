---
'posthog-js': patch
'@posthog/browser-common': patch
'@posthog/types': patch
---

Capture the Snapchat click ID as `sccid` when the landing URL spells it `ScCid` or `SsCid`, and mask those spellings when `mask_personal_data_properties` is on.
