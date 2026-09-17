---
'posthog-js': patch
---

Log a console warning when session replay stops capturing canvas frames (browser without `OffscreenCanvas`, a CSP that blocks `blob:` workers, or a failing `canvasCapture.maskRegionsFn`), and stop changing WebGL and WebGPU canvas settings when canvas capture fails to start
