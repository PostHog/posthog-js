---
'@posthog/core': patch
---

fix(error-tracking): keep one copy of a repeated frame cycle in parsed stack traces, so a stack overflow reports the same frames on every throw instead of opening a new issue each time
