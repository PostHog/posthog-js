---
'posthog-js': minor
---

Add `posthog.conversations.getUnavailableReason()` to expose why the conversations API is unavailable (bundle blocked/failed to load, disabled in project, remote config not loaded yet, still initializing, …) instead of collapsing every case into `isAvailable() === false`. Lets callers that fall back to another channel record the specific cause.
