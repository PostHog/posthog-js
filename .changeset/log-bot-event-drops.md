---
'posthog-js': patch
---

Log a debug-level message and increment an instance-level `botEventsDropped` counter whenever the user-agent bot filter drops a `capture()` call, so it's possible to see when and why pageviews are being filtered instead of the drop being silent.
