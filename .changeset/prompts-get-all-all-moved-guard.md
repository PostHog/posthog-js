---
'@posthog/ai': patch
---

`prompts.getAll` now throws the server-compatibility error when the server returned prompts but none resolve the requested label, instead of returning an empty result. This happens on PostHog servers without label support on the prompt list endpoint when every label points at an older version.
