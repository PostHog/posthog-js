---
'posthog-react-native': minor
'@posthog/core': minor
---

feat(react-native): allow disabling the survey question ScrollView via `appearance.disableScrolling`

Adds an opt-in `disableScrolling` flag on `SurveyAppearance` so React Native embedders can
render single-question surveys without the wrapping `ScrollView` (and its
`keyboardShouldPersistTaps="handled"` wiring), which was causing UX issues for short surveys
(iOS bounce, keyboard tap-handling). Defaults to `false` to preserve current behavior.
Overflowing content is silently clipped when enabled — opt in only for short surveys.
