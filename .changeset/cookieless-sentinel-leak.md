---
'posthog-js': patch
---

fix(browser): stop the `$posthog_cookieless` sentinel from leaking into `identify()` and real events. A tab that missed a cross-tab consent flip could emit the sentinel as a durable distinct_id — merging distinct real users into a single person. It now self-heals to a fresh anonymous device id.
