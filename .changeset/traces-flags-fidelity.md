---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Propagate the inbound W3C sampled flag on a continued trace instead of always sending `01`, so a downstream parent-based sampler sees the decision the head sampler made. Spans are still recorded and exported either way. Exported spans also carry OpenTelemetry's parent-remoteness bits, so a span that entered the service over HTTP is distinguishable from one started locally.
