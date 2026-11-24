---
'@posthog/browser-common': patch
---

Let a browser SDK that reads the `/flags?v=4` response send the config version 2 flag events. SDKs that do not opt in send `$feature_flag_called` as before.
