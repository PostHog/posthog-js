---
'posthog-js': patch
---

fix(surveys): stop recurring surveys re-showing off a stale internal targeting flag

Recurring surveys could re-display and record a duplicate response when the eligibility
check ran against a cached internal targeting flag before fresh flags had loaded. The
display loop now waits for feature flags to actually load before trusting the internal
targeting flag, and forces a flag reload after a survey is completed so the flag recomputes
promptly.
