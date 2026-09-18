---
'@posthog/core': patch
---

Coerce survey and product tour property filter values to strings before matching, so a numeric filter value from the `/surveys` response no longer throws in `icontains`/`not_icontains`
