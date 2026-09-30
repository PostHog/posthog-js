---
'posthog-js': patch
---

Start session recording at `DOMContentLoaded`, so a page whose `load` event is late or never fires still records, and report `$sdk_debug_rrweb_attached` from rrweb's own recording state
