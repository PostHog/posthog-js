---
'@posthog/core': patch
'posthog-js': patch
---

fix(exception-autocapture): keep location and message for errors with no Error object

Exception autocapture threw away useful signal for errors that arrive without a real `Error`
object (a cross-origin `"Script error."`, older browsers, or code that forwards a bare
`ErrorEvent`). Two related fixes:

- The `window.onerror` wrapper only forwarded `error || event`, silently dropping the
  `source`/`lineno`/`colno` the browser passes positionally. It now reconstructs an
  `ErrorEvent` from those args when there's no Error object, so the location is preserved.
- The `ErrorEventCoercer` only handled `ErrorEvent`s whose `.error` was set; others fell
  through to the `EventCoercer` and became junk like `"ErrorEvent captured as exception with
  keys: ..."` (empty type, no stack, a fresh fingerprint per build). It now salvages the
  event's `message` into a real `Error` and synthesizes a stack frame from
  `filename`/`lineno`/`colno` when present, so the error is source-mappable and groups by
  location. Bare `ErrorEvent`s with neither a message nor an error still fall through unchanged.
