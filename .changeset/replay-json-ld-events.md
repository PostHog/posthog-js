---
'posthog-js': minor
'@posthog/types': patch
---

Add opt-in Schema.org JSON-LD capture to session replay through `session_recording.captureJsonLd`. When enabled, the recorder emits sanitized JSON-LD as custom replay events and excludes all script elements from replay snapshots.
