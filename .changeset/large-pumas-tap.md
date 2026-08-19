---
'posthog-js': patch
---

Fix session recording in the full browser bundles. `array.full.js` and `module.full.es.js` only inlined rrweb, so they still fetched the recorder script at runtime - the request the full bundles exist to avoid. They now inline the whole recorder. Also flags the session with `$sdk_debug_recording_script_not_loaded` when the recorder script fails to load, so a blocked recorder is visible in analytics rather than only in the console.
