---
'posthog-js': patch
---

Keep autocapture off when a remote config response omits `autocapture_opt_out`. The SDK now retains the last known server value for the missing-field case, the same as when the config fetch fails, instead of enabling autocapture. Values persisted by earlier SDK versions are still trusted; a browser holding a stale value corrects itself on the first config response that includes the field.
