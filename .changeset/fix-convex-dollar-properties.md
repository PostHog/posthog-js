---
'@posthog/convex': patch
---

fix: support $-prefixed property keys (e.g. $ai_model, $set) by JSON-serializing properties before passing through Convex's value system
