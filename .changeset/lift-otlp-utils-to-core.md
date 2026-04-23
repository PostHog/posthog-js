---
'posthog-js': patch
'@posthog/types': patch
'@posthog/core': patch
---

Lift OTLP log serialization helpers from posthog-js into @posthog/core so the
upcoming React Native logs feature consumes the same builders. Browser gains
two fixes as a side effect: NaN and ±Infinity attribute values no longer get
silently dropped during JSON encoding, and the scope.version OTLP field is
now populated with the SDK version (changes the server's instrumentation_scope
column from "posthog-js@" to "posthog-js@<semver>").
