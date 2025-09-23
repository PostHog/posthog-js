---
'posthog-js': patch
---

fix: lazy loaded replay relies on remote config having been persisted in storage to avoid race with config on restart
