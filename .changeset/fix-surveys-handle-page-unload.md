---
'posthog-js': patch
---

Fix `TypeError: handlePageUnload is not a function` thrown on page unload when a version-skewed lazy-loaded surveys chunk produces a survey manager whose prototype lacks `handlePageUnload`. The delegated call in `PostHogSurveys.handlePageUnload()` now guards the method as well as the receiver.
