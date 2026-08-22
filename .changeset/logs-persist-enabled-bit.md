---
'posthog-js': patch
---

Console log capture now buffers early console entries on repeat visits. When remote config previously enabled log capture, the SDK records console calls from init and replays them once remote config confirms capture is still enabled, so early startup logs are no longer lost. If remote config says capture is disabled, the buffer is dropped and the console is restored untouched.
