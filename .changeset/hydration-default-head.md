---
'posthog-js': patch
---

Default `external_scripts_inject_target` to `'head'` unconditionally to prevent React hydration mismatches in SSR apps (e.g. Next.js pages that render body-level `<script type="application/ld+json">`). Previously this default only applied when `defaults: '2026-01-30'` was set. Users who want the legacy behavior can still opt in with `external_scripts_inject_target: 'body'`.
