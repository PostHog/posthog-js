---
'posthog-js': minor
'@posthog/core': minor
'posthog-react-native': minor
---

feat(surveys): optional intro screen shown before the first question

Surveys can now display an intro screen before question 1, configured via the new
`displayIntroScreen`, `introScreenHeader`, `introScreenDescription`,
`introScreenDescriptionContentType`, and `introScreenButtonText` appearance fields.
The intro is dismissed with a button and records no response, does not affect
completion or partial-response metrics, does not re-fire "survey shown", and is
skipped when a survey is resumed with answers in progress. Intro copy is
translatable like the thank-you message. `renderSurveysPreview` accepts
`previewPageIndex: -1` (exported as `INTRO_SCREEN_PREVIEW_INDEX`) to preview the
intro screen.
