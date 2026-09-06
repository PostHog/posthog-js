---
'@posthog/browser-common': patch
'posthog-js': patch
---

Stop a broken page clock from breaking every capture

`uuidv7()` passed `Date.now()` straight into `UUID.fromFieldsV7`, which accepts only an integer in
`[0, 2**48)`. A system clock set before 1970, or a script or extension that replaces `Date.now()`
with a fractional or non-finite value, made it throw `RangeError: invalid field value`. A UUID is
generated for every captured event, so that throw escaped into the host page. The clock read is now
clamped to the range the field allows.

The session recorder also captures each snapshot chunk on its own, so a chunk that cannot be
captured no longer drops the chunks queued behind it.
