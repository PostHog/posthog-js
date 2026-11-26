---
'@posthog/ai': patch
---

Prompts.compile() no longer replaces placeholders such as {{constructor}} or {{toString}} with inherited object properties when no matching variable is provided
