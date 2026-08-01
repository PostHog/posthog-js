---
'posthog-node': patch
---

Fix `enableExceptionAutocapture` suppressing Node's default crash on unhandled promise rejections; rejections handled by another `unhandledRejection` listener are no longer captured.
