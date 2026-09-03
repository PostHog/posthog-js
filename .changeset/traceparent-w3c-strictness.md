---
'posthog-node': patch
'@posthog/core': patch
---

Start a fresh trace on an inbound `traceparent` that W3C requires a vendor to ignore, rather than continuing it. Two headers were being accepted: a version `00` header carrying fields beyond `trace-id`, `parent-id` and `trace-flags`, and one whose ids are uppercase hex. Both were continued here while a conformant peer restarts the trace, so a request crossing the two ended up split across two trace IDs. Unknown trailing fields on a _higher_ version are still ignored, as the spec intends.
