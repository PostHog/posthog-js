---
"posthog-js": patch
---

Apply the stylesheet inlining budget when the recorder serializes an added DOM subtree, and stop recording repeated oversized subtree additions, so a page that rebuilds a large same-origin subtree no longer freezes.
