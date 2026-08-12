---
'posthog-js': patch
'@posthog/types': patch
---

feat(dead-clicks): treat a network request started after a click as a liveness signal

Async-action buttons (kick off a `fetch`, render the result when it returns) often take longer than the mutation window to produce a visible change, so their clicks were flagged as false-positive dead clicks even though they worked. Dead-click autocapture now wraps `fetch` with a deliberately minimal, timestamp-only observer: a request started shortly after a click counts as the click doing something and suppresses the dead click — keyed on request *start*, not completion, so a slow response still suppresses. It only ever suppresses, never marks a click dead. PostHog's own requests are excluded so background traffic can't blanket-suppress. The wrapper is self-contained (not tied to the session recorder's network capture, which is gated behind session recording) and unwraps conservatively so it never clobbers another library's `fetch` wrapper. Emits `$dead_click_network_request_delay_ms` for observability.
