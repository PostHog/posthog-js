---
'posthog-react-native': major
---

- **Breaking:** send events to capture v1 (`/i/v1/analytics/events`) instead of `/batch/`, authenticated with `Authorization: Bearer <projectToken>` — serve this path on reverse proxies and self-hosted instances
- **Breaking:** `Authorization`, `User-Agent`, `Content-Type`, `Content-Encoding` and the `PostHog-` headers the SDK sets no longer reach capture requests from `requestHeaders`; other `requestHeaders` still do
- Keep events queued when a send gets no response, a 404, 408, 429, 500, 502, 503 or 504, or a `retry` result, and send them again after a wait of 1 second doubling to 30 seconds (longer if the server's `Retry-After` asks, up to 30 seconds), with no attempt limit
- `flush()` and `shutdown()` no longer reject when events stay queued for a later send
- **Breaking:** `fetchRetryCount` and `fetchRetryDelay` no longer apply to event delivery
- **Breaking:** `posthog.on('error')` no longer fires for network errors or retryable statuses while events stay queued; it still fires for dropped events, with an error carrying `drops`, `requestId`, `retryExhausted` and `cause` instead of `response`
- Cap each capture request at 5 MiB of event bytes, starting a new request before a batch would pass it
