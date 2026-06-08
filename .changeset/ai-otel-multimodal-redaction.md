---
'@posthog/ai': minor
---

Redact base64/binary multimodal content from AI spans in the OTel `PostHogSpanProcessor` and `PostHogTraceExporter` before export, matching the redaction already applied by the direct provider wrappers. Content is redacted by value (data URLs and large base64 blobs) across span attributes and span events, so it works regardless of which GenAI semantic convention produced the span.
