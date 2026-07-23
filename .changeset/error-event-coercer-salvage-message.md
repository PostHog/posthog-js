---
'@posthog/core': patch
---

fix(exception-autocapture): salvage ErrorEvents that carry a message but no Error

The `ErrorEventCoercer` previously only handled `ErrorEvent`s whose `.error` property was
set, so events that arrive with a usable `message` and location but no Error object — e.g. a
cross-origin `"Script error."`, or browsers that populate the message but not `.error` —
fell through to the `EventCoercer` and were rendered as junk like `"ErrorEvent captured as
exception with keys: ..."` (empty type, no stack, a fresh fingerprint per build). The coercer
now salvages these into a real `Error` exception using the event's `message`, and synthesizes
a stack frame from `filename`/`lineno`/`colno` when present so the error is source-mappable
and groups by location instead of becoming noise. Bare `ErrorEvent`s with neither a message
nor an error still fall through unchanged.
