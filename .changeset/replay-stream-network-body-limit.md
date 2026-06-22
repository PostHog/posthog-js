---
'posthog-js': patch
'@posthog/types': patch
---

Session replay network capture: add an opt-in streaming reader for request/response bodies that stops at the payload size limit instead of buffering the whole body and then discarding it — bounding memory and pre-request latency when a body is very large. It reads only a clone of the body, so it never consumes the stream the page itself reads, and always resolves (never rejects) into the page's `fetch`. Off by default; enabled for `defaults: '2026-05-30'` and settable directly via `session_recording.streamNetworkBody`.
