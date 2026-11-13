---
'posthog-node': patch
---

A `before_send` hook that throws is now logged with `console.error` even when `debug` is off, so the dropped event is never silent. The line still names only the event and the error's type.
