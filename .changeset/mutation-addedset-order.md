---
'@posthog/rrweb': patch
---

perf: when a node is re-encountered while collecting added nodes, move it to the end of the added set so the emit phase processes adds in latest-DOM order. This avoids paying for out-of-order deferrals on large mutation batches (port of upstream rrweb #1302).
