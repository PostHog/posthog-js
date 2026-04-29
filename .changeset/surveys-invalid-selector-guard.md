---
'posthog-js': patch
---

Fix surveys silently failing site-wide when a single survey was configured with an invalid CSS selector. `doesSurveyMatchSelector` now catches `querySelector` parse errors and treats only the misconfigured survey as non-matching instead of aborting the whole eligibility filter.
