---
'@posthog/core': patch
---

fix(logs): when a logs `beforeSend` hook throws, log the error and drop the record (fail closed) instead of continuing the chain and enqueuing it — a buggy redaction hook must not leak an unredacted log record.
