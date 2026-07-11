---
'@posthog/rrweb-utils': patch
---

fix: keep the untainted-prototype fallback iframe attached on Safari so MutationObserver callbacks are not silently dropped (port of upstream rrweb #1854)
