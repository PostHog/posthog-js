---
"@posthog/webpack-plugin": patch
---

Default `sourcemaps.enabled` to `true`, matching the other PostHog bundler plugins. Previously it defaulted to `NODE_ENV === 'production'`.
