---
"posthog-js": patch
---

fix(web-vitals): prevent memory leak by cleaning up PerformanceObservers

Store and invoke cleanup functions returned by web-vitals library callbacks to prevent DOM references from being retained across page navigations in SPAs.
