---
'posthog-js': minor
'@posthog/core': minor
---

feat(surveys): add opt-in `appearance.allowGoBack` for multi-question surveys, and make button labels translatable

Renders a "Back" button on web surveys after the first question. Default is off — existing surveys are unchanged. Uses a visited-index history stack so back-navigation respects branching paths (`response_based`, `specific_question`), and abandoned-branch responses are pruned before submission so analytics aren't polluted. Returning to a question pre-fills the prior answer. `appearance.backButtonText` overrides the default label. The button uses the survey's text color so it stays readable on any background, and it also shows in survey previews.

Also adds `submitButtonText` and `backButtonText` to survey-level translations, so both the submit and back button labels can be localized via `appearance` translations (previously only the per-question button text was translatable).
