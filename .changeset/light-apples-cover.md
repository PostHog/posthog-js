---
'posthog-node': patch
---

Fix bug where flag doesn't fallback to the server correctly when one condition is a static cohort condition but a later condition matches.
