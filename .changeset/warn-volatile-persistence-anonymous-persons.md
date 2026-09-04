---
'posthog-js': patch
'@posthog/types': patch
---

Warn at init when `persistence` is `memory` or `sessionStorage` (or persistence is disabled) while `person_profiles` is `always`. `memory` and disabled persistence drop the distinct ID on every page load, and `sessionStorage` drops it whenever a browser tab or window starts with an empty store. PostHog then mints a new ID, and under `person_profiles: 'always'` each new ID becomes a separate anonymous person.
