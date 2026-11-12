---
'posthog-js': minor
'@posthog/types': patch
---

When the experimental `metrics.flags` option is on, the browser SDK splits each `/flags` attempt that gets a response into three histograms with the same attributes as `posthog.flags.request.duration`. `posthog.flags.request.pre_send_duration` runs from dispatch until the request starts, which includes body compression. `posthog.flags.request.network_duration` runs from the request start until the last byte of the response arrives, taken from the request's Resource Timing entry. `posthog.flags.request.main_thread_duration` runs from that last byte until the SDK's callback runs, which includes reading and parsing the response body. The three add up to the total. An attempt records them only when the browser reports its Resource Timing entry within 5 seconds of the callback and that entry can't belong to another request to the same URL, so it may record the total without them. `posthog.flags.request.duration` is unchanged. The option, the metric names, and their attributes may change or be removed in any release.
