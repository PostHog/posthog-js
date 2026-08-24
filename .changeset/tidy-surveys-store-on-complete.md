---
'posthog-js': patch
---

Surveys: a prefilled survey no longer records a response before the respondent finishes.

`initialResponses` passed to `posthog.displaySurvey()` now follows the same gate as URL prefill: a response is recorded only when the prefill completes the survey, or when partial responses are enabled and the prefilled questions auto-submit. Previously any prefill recorded a `survey sent` immediately, so a survey set to record only completed responses could store a one-answer response and set `$survey_responded` on the person.

If you report on prefilled surveys, note that an incomplete prefill no longer emits a `survey sent` when the survey is shown, so a prefilled survey that is then completed produces one `survey sent` instead of two. With partial responses enabled, that event now carries only the auto-submitted answers rather than every prefilled answer.

Question shuffling is skipped for surveys that use branching, and for a survey the respondent has already started, because both rely on the configured question order.
