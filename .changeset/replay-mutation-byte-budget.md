---
'posthog-js': patch
'@posthog/types': patch
---

Session replay can now bound DOM mutation bytes with an opt-in budget. Set `__mutationBytesBucketSize` (e.g. 1MB) to enable: mutations beyond the sustained budget (`__mutationBytesRefillRate`, default 25KB/s) are dropped and the recording resyncs with a full snapshot, keeping recordings from apps with very high DOM churn playable. Off by default.
