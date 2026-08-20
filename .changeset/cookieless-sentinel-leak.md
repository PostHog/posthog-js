---
'posthog-js': patch
---

fix(browser): stop the `$posthog_cookieless` sentinel from leaking into `identify()` and real events. A tab that missed a cross-tab consent flip could emit the sentinel as a durable distinct_id — merging distinct real users into a single person. It now adopts the identity persisted by the tab that handled consent, falling back to a fresh anonymous device id when persistence is not shared.
