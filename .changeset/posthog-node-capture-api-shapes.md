---
'posthog-node': major
---

`captureException()` and `captureExceptionImmediate()` take an options object (`distinctId`, `properties`, `options`, `uuid`, `flags`, `level`); the old positional form still works in 6.x and logs a deprecation error once.
`registerOptions()` and `unregisterOptions()` return a promise, and `prepareEventMessage()` returns a flat message with top-level `options`, `uuid`, `timestamp` and `disableGeoip`.
