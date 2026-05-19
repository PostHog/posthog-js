---
'posthog-js': minor
'@posthog/core': minor
---

feat(surveys): add opt-in `appearance.allowGoBack` for multi-question surveys

Renders a "Back" button on web surveys after the first question. Default is off — existing surveys are unchanged. Uses a visited-index history stack so back-navigation respects branching paths (`response_based`, `specific_question`), and abandoned-branch responses are pruned before submission so analytics aren't polluted. Returning to a question pre-fills the prior answer. `appearance.backButtonText` overrides the default label.
