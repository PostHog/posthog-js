---
'posthog-js': patch
---

Fix inline surveys rendering an empty container when a stale persisted question index (left over from a prior completion) points past the last question. When the persisted index is out of range the whole in-progress record is now discarded and the survey starts fresh, instead of clamping the index while keeping the equally-stale responses and visited indices. Restored visited indices are also filtered to valid questions so the Back button can never navigate to a non-existent question and re-empty the container.
