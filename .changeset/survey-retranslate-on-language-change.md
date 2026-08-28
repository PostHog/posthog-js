---
'posthog-js': patch
'@posthog/core': patch
---

Re-translate popover surveys when the display language changes while the survey is on screen, either from a browser `languagechange` event or from `identify()` updating the `language` person property. In-progress answers are preserved. `$survey_questions[].question` and `$survey_language` on `survey sent` / `survey dismissed` now report the text and language the user saw when they answered, not the language active when the event fired. Feedback-button (widget) surveys are unchanged.
