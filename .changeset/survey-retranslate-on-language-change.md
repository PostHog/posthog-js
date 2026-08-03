---
'posthog-js': patch
'@posthog/core': patch
---

fix(surveys): re-translate displayed surveys when the user's language changes mid-session — handles both browser `languagechange` events and `posthog.identify()` calls that update the `language` person property. Also snapshots each question's displayed text and language at answer time (`questionSnapshots`), so `$survey_questions` and `$survey_language` reflect what the user actually saw rather than the language active when the event was sent.
