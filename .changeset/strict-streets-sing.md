---
'posthog-js': minor
'@posthog/types': minor
---

RemoteConfig (config.js) has been loaded for ages and is in use by us in production. This PR makes it the sole config loading mechanism for posthog-js, removing the legacy /flags/?v=2&config=true path and the \_\_preview_remote_config gate.
