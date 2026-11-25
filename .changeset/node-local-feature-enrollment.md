---
'posthog-node': minor
---

Local evaluation supports early-access feature enrollment. For a flag with `feature_enrollment`, the person property `$feature_enrollment/<flag key>` decides the flag before holdouts and release conditions: `true` or `"true"` is enrolled, any other value is opted out, and without it the flag falls back to `/flags`
