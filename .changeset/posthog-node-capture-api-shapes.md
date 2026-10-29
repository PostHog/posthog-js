---
'posthog-node': major
---

`captureException()` and `captureExceptionImmediate()` take an options object (`distinctId`, `properties`, `options`, `uuid`, `flags`, `level`); the old positional form still works in 6.x and logs a deprecation error once per method. `level` is read case-insensitively, with the same aliases as posthog-python (`critical` → `fatal`, `warn` → `warning`); an unknown level keeps `error`.
`registerOptions()` and `unregisterOptions()` return a promise, and `prepareEventMessage()` returns a flat message with top-level `options`, `uuid`, `timestamp` and `disableGeoip`.
