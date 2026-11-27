---
'posthog-js': patch
---

Fix `tracing_headers` not following consent changes in `cookieless_mode: "on_reject"`: the session ID header was missing after opting in and still sent after opting out. Requests to `tracing_headers` hosts also no longer keep PostHog ID headers the SDK has no current value for
