---
'@posthog/core': patch
'posthog-node': patch
'@posthog/convex': patch
---

Local flag evaluation now matches a null property with string operators like the flags service, so negated operators such as `not_icontains` match instead of failing.
