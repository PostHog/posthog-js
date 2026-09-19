---
'posthog-js': minor
'@posthog/types': minor
---

Watch open shadow roots for dead click detection, so a click that only changes content inside a shadow root is no longer reported as a dead click. Adds `capture_dead_clicks.mutation_observer_roots` for roots the SDK cannot reach, for example a closed shadow root
