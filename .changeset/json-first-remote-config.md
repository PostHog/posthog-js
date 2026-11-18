---
'posthog-js': minor
---

Load remote config as JSON with `fetch` instead of executable `config.js` when site apps are disabled (the default). The SDK no longer falls back to `config.js` when the JSON request fails.

**Action may be required if you use a Content Security Policy without a reverse proxy:** remote config is now fetched from the assets host, so `connect-src` must allow it, not only `script-src`. Add `https://us-assets.i.posthog.com` (US), `https://eu-assets.i.posthog.com` (EU), or `https://*.posthog.com` to `connect-src`. Otherwise remote config fails to load, so features such as session recording, surveys, and autocapture use their default or saved settings. Feature flags are unaffected. Sites using a reverse proxy, no CSP, or `opt_in_site_apps: true` need no change.
