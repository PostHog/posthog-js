---
'posthog-js': patch
---

Stop the internal `SCRIPT_PLACEHOLDER` from rendering during replay. A recorded `<script>` is rebuilt as `<noscript>`, whose text shows when scripting is off in the replay iframe. The document-scoped hide style never reaches shadow roots, so the placeholder leaked over third-party widgets recorded in a shadow root. Rebuild now emits an empty text node for the placeholder, so it cannot render in any context.
