---
'posthog-js': minor
'@posthog/types': minor
---

Add a `get_current_url` config option that overrides the URL used for client-side URL targeting — session replay URL triggers, the session replay URL blocklist, survey URL display conditions, product tour URL conditions, and web experiment URL conditions. These match against `window.location.href` directly, which does not reflect a `$current_url` rewritten in `before_send`. Apps where the browser URL is not meaningful for targeting (e.g. Electron/desktop builds served from a generated host) can now return the logical URL to match against. Defaults to `window.location.href` when not set.
