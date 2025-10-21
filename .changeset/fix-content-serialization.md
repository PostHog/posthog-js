---
'@posthog/ai': patch
---

fix: prevent [object Object] in content serialization - structured content is now properly JSON-stringified instead of being converted to "[object Object]"
