---
"@posthog/core": patch
---

Prevent shutdown from looping forever when a flush makes no queue progress.
