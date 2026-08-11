---
'posthog-js': patch
---

Fix a Chrome renderer crash (grey "Aw, Snap" tab) that could occur when closing an in-app survey.

The survey close path wrapped the survey container's DOM removal in `document.startViewTransition`. Removing the element inside the transition callback left the captured snapshot pointing at a removed node, which on heavy SPAs triggered a Chromium renderer crash and took down the whole tab.

The close path now only animates a fade-out inside the transition and lets React tear the container down once the transition settles. It also guards against overlapping transitions (a second close while one is animating) and always settles the popup state if the transition is skipped or interrupted, so the survey can never be left visible with a stale reference.
