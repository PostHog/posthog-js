---
'posthog-js': minor
'@posthog/types': minor
---

feat(surveys): add `slider` survey question type (`SurveyQuestionType.Slider`). Accepts `min`, `max`, `step`, optional `prefix`/`suffix` for the displayed value, and `lowerBoundLabel`/`upperBoundLabel`. The slider renders full-width with the live value updating continuously during drag, and a row beneath showing the lower label, current value chip, and upper label.
