---
'@posthog/rrweb': patch
---

fix: non-user-initiated events (media autoplay, canvas/font/stylesheet churn) no longer unfreeze a frozen page, so background activity cannot flush the frozen mutation buffer (port of upstream rrweb #1697)
