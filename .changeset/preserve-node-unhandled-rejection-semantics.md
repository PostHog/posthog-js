---
'posthog-node': patch
---

Fix `enableExceptionAutocapture` suppressing Node's default crash on unhandled promise rejections; fatal rejections in `strict` or `warn-with-error-code` mode and rejections handled by another `unhandledRejection` listener are no longer captured.
