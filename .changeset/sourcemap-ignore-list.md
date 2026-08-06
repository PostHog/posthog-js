---
'posthog-js': patch
---

Mark our bundles as third-party code in the source maps we publish (the `x_google_ignoreList` extension). Browser devtools now attribute `console.*` messages to the code that called them instead of to posthog-js's console wrapper, which previously showed every message as coming from `logs.ts` when `captureConsoleLogs` or session replay's `enable_recording_console_log` was enabled.
