---
'posthog-js': patch
---

Stop posthog-js's own request-timeout aborts from being captured as `$exception` events in error tracking. When our 60s request timeout fires we abort the fetch with an identifiable `AbortError` ("PostHog request timed out ..."); exception autocapture now recognises and drops that benign, already-handled abort while still letting genuine host-app `AbortError`s through. Previous attempts relied on lowering the log level, which does not gate autocapture because the logger is a no-op unless debug is enabled.
