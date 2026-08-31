---
'posthog-js': patch
---

Flush a pending initial `$pageview` over `sendBeacon` on page unload. A fast client-side or authentication redirect can cancel the immediate fetch that carries the initial pageview, and a page that loads while hidden defers its pageview until `visibilitychange`, which never fires if the page closes first. In both cases the `$pageleave` still survives on `sendBeacon`, so Web Analytics recorded a pageleave with no matching pageview.
