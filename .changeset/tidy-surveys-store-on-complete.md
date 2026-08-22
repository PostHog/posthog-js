---
'posthog-js': patch
---

Surveys: stop storing a one-answer response when the survey must store a response only on completion. Prefilled initial responses now follow the same partial-response gate as URL prefill. Shuffled questions now map back to the canonical order before branching, so branching reads the answered question and does not end the survey after one answer.
