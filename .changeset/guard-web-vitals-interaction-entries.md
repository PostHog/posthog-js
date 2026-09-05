---
'posthog-js': patch
---

Stop the web vitals attribution bundle from throwing an uncaught `TypeError: Cannot read properties of undefined (reading 'startTime')`. The bundled `web-vitals` INP observer compared a new event timing entry against the first entry of the longest interaction without checking that the entry exists, so an emptied entries list threw inside a `PerformanceObserver` callback, where no PostHog code can catch it. The error reached the host application's console and error tracking, and it stopped that metric from reporting. A patch on `web-vitals@6.2.1` guards the read. The patch also points the package's ES module entry points at its unminified module build, so the attribution bundles no longer ship two copies of the library and get about 35% smaller.
