---
'posthog-js': patch
---

Autocapture works again in Internet Explorer 11. The label-click check added to rage-click detection called `Element.closest`, which IE11 doesn't have, so the click after a label click failed to be captured.
