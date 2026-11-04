---
'posthog-js': minor
'@posthog/types': minor
---

Add the `metrics.flags` option. When it is on, the browser SDK records the round trip of every `/flags` HTTP attempt as the histogram `posthog.flags.request.duration`, with the server host, the response status or error type, and the browser's timezone as attributes.
