---
"posthog-js": patch
---

fix(replay): measure `$snapshot_bytes` as UTF-8 byte length instead of UTF-16 string length, so non-ASCII session replay payloads are counted accurately against the message size limit
