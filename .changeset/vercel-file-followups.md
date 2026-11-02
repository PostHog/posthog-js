---
'@posthog/ai': patch
---

Vercel AI SDK file capture: keep provider file IDs like `file-abc123` as they are instead of turning them into data URLs, use the same placeholder for an over-budget file however it was passed, and skip encoding output files in privacy mode
