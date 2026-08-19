---
'posthog-js': patch
'@posthog/types': patch
---

Expose `keepIframeSrcFn` in `session_recording` config. A cross-origin iframe that PostHog cannot record into (for example a HubSpot Meetings calendar) has its `src` stripped by default and plays back as a blank box. Set `keepIframeSrcFn` to keep the `src` for chosen URLs, so the live third-party widget renders during playback. The default keeps the current strip-by-default behavior.
