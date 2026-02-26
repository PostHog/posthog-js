---
'posthog-js': patch
---

fix: Improve tablet device type detection when Chrome sends desktop-like UA strings

Chrome on Android tablets defaults to "request desktop site" mode, sending a UA string
indistinguishable from desktop Linux. This uses the Client Hints API (navigator.userAgentData.platform)
and touch capability (navigator.maxTouchPoints) to correctly classify these devices as Tablet or Mobile
when UA-based detection falls through to the Desktop default.
