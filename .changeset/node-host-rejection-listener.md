---
'posthog-node': patch
---

fix: exception autocapture now captures unhandled promise rejections when the app or framework (for example Next.js) has its own `unhandledRejection` listener
