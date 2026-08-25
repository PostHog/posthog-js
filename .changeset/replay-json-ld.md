---
'posthog-js': minor
'@posthog/types': patch
---

Add opt-in Schema.org JSON-LD capture to session replay through `session_recording.captureJsonLd`. The recorder parses each JSON-LD script and creates new JSON from type-specific property rules. It drops JSON-LD by default. When capture is enabled, it also drops invalid scripts, masked scripts, unsupported types, and all properties that the rules do not include. Replay rebuilds each recorded script as an inert `noscript` element.
