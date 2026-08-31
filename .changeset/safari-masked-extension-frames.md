---
'posthog-js': patch
---

Error tracking now drops a known uBlock Origin Lite exception thrown by its Safari extension. Safari masks extension content-script URLs as `webkit-masked-url://hidden/`, but also uses that URL for application code, so the filter requires the extension's error signature before dropping an all-masked stack. A remaining unmasked `in_app` frame still preserves the exception as first-party.
