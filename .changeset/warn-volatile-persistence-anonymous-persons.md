---
'posthog-js': patch
'@posthog/types': patch
---

Warn at init when `persistence` is `memory` or `sessionStorage` (or persistence is disabled) while `person_profiles` is `always`, because each page load then creates a new anonymous person.
