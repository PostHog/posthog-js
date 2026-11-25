---
'posthog-js': patch
---

Request URLs keep query values that contain `=`, query keys without a value, and the URL fragment when the SDK adds `compression`, `retry_count` or timestamp params. A `rewriteRequestPath` URL ending in `?sig=abc==` was sent as `?sig=abc`, and `?debug` was sent as `?debug=undefined`.
