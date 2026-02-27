---
"posthog-node": patch
---

Improve local feature flag evaluation debugging by adding timestamp tracking. Locally evaluated flags now include timing information in `$feature_flag_called` events to help debug cache TTL and timing issues, matching what's available for remote evaluation.