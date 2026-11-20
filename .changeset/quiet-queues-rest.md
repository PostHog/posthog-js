---
'posthog-js': patch
'posthog-react-native': patch
---

Only attach the queue-size debug property while the queue is backed up: `$sdk_debug_retry_queue_size` on web when requests are waiting to be retried, and `$sdk_debug_pending_queue_size` on React Native once the queue reaches `flushAt`
