---
"posthog-js": patch
"@posthog/types": patch
---

Apply the stylesheet inlining budget when the recorder serializes an added DOM subtree or a same-origin iframe document, and stop recording repeated oversized subtree additions, so a page that rebuilds a large same-origin subtree or iframe no longer inlines every stylesheet synchronously on each rebuild.
