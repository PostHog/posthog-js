---
'posthog-js': patch
'@posthog/types': patch
---

Fix dead-click detection for text selection and editable caret gestures when mouse release is delayed, while continuing to report inert text clicks.
