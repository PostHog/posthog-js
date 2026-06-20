---
'posthog-js': patch
---

Session replay network capture: never record binary/asset response bodies (images, video, audio, fonts, etc.), skip Datadog browser-RUM intake hosts, and redact credential-bearing headers on both request and response by name heuristic (e.g. custom `*-token` headers) - reducing recording size and avoiding accidental credential capture.
