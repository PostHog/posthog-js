---
'posthog-js': patch
---

Surveys: submit open text questions with Cmd/Ctrl+Enter. The textarea still inserts a newline on plain Enter (native behaviour), matching the convention used by Slack, GitHub, Discord, and ChatGPT for multi-line inputs. Single-line "Other:" inputs continue to submit on plain Enter as before.
