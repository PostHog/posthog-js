---
'@posthog/ai': patch
---

fix: sanitize base64 images before formatting in Responses API to prevent 413 payload-too-large errors
