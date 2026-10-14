---
'@posthog/ai': patch
---

`prompts.get()` now makes one request when several callers ask for the same prompt at once, instead of one request per caller. Prompt fetches also time out after 10 seconds instead of hanging on a stalled connection, and `PromptFetchError` is exported so callers can tell a timeout or server error from a missing prompt.
