---
'posthog-js': patch
---

Fix surveys recording a response before the respondent finishes, and reordering questions for surveys that use branching, are prefilled, or are resumed

An `initialResponses` prefill passed to `posthog.displaySurvey()` that neither completes the survey nor auto-advances a question no longer sends `survey sent`, and a partial event carries only the auto-advanced answers.
