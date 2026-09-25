---
'@posthog/react': patch
'posthog-js': patch
---

Fix `useThumbSurvey` from `@posthog/react/surveys` and `posthog-js/react/surveys` ignoring the client passed to `PostHogProvider`, which left it capturing no survey events.
