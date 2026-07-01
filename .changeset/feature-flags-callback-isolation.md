---
"posthog-js": patch
---

fix(web): isolate `onFeatureFlags` callbacks so a throwing user handler no longer breaks the remaining callback chain or gets misattributed as an SDK error
