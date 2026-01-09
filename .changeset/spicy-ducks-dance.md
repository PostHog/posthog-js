---
'posthog-js': patch
---

Fix survey URL prefill to respect branching/skip logic

When using URL parameters to prefill survey responses (e.g., `?q0=9`), the SDK now correctly respects the survey's branching configuration. Previously, prefilled answers would always advance to the next sequential question, ignoring any skip logic.
