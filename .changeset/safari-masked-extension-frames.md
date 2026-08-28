---
'posthog-js': patch
---

Error tracking now drops exceptions thrown by Safari browser extensions. Safari masks the URL of extension content scripts as `webkit-masked-url://hidden/`, so the extension filter missed them and captured the errors as first-party. The filter drops a masked-frame exception only when no `in_app` frame remains, because Safari masks some of the page's own scripts the same way.
