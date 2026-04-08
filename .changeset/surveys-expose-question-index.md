---
'posthog-js': patch
---

Expose the current question index on `.survey-box` via a `data-question-index` attribute. This gives consumers rendering surveys via the API a reliable way to know which question is currently displayed without parsing input ids or class names — works for every question type, including link questions which render no input or rating element.
