---
'posthog-js': patch
---

fix(surveys): re-translate displayed surveys when the user's language changes mid-session — handles both browser `languagechange` events and `posthog.identify()` calls that update the `language` person property
