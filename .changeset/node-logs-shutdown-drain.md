---
'posthog-node': patch
---

fix(node): `shutdown()` now also sends logs captured while its logs flush was in flight, instead of dropping them
