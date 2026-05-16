---
'posthog-js': minor
'@posthog/types': minor
---

Dead clicks: add a `.ph-no-deadclick` CSS class (and `capture_dead_clicks.css_selector_ignorelist` config option) to exclude specific elements from dead-click detection without affecting autocapture, session replay, or heatmaps. Mirrors the existing `.ph-no-rageclick` pattern.
