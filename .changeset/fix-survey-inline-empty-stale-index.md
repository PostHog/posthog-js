---
'posthog-js': patch
---

Fix inline surveys rendering an empty container when a stale persisted question index (left over from a prior completion) points past the last question. The current question index is now clamped back into range, so an inline re-display renders the survey instead of an empty `.ph-survey` element.
