---
'@posthog/rollup-plugin': patch
---

Set Vite build sourcemap config before transform plugins run so uploaded source maps include original sources. The plugin also no longer overrides the `sourcemap` setting when `sourcemaps.enabled` is `false`.
