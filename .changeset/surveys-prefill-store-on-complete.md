---
'posthog-js': patch
---

Stop `displaySurvey()` recording a `survey sent` event for an `initialResponses` prefill that neither completes the survey nor auto-advances a question, and limit the partial event to the auto-advanced answers
