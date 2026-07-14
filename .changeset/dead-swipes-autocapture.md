---
'posthog-js': minor
'@posthog/types': minor
---

Add dead swipe detection to dead clicks autocapture. When dead clicks autocapture is enabled, touch swipe gestures that produce no observable screen change (no scroll, mutation, selection or visibility change) are now captured as `$dead_swipe` events, surfacing failed navigations on touch devices. Configurable via `capture_dead_swipes` (default `true`) and `swipe_threshold_px` (default `30`) on the `capture_dead_clicks` config.
