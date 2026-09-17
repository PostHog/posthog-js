---
'posthog-js': patch
---

Keep recording a session when the page draws a cross-origin image into a canvas. Such a canvas is tainted, and reading its pixels throws a `SecurityError`. That error used to escape the full snapshot and stop the whole recording. The tainted canvas is now left out of the recording, the rest of the page still records, and a console warning says which canvas failed
