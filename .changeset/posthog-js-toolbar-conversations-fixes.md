---
'posthog-js': patch
---

Render surveys, product tours and conversations without a stylesheet when `prepare_external_dependency_stylesheet` throws, reload the toolbar once per Turbolinks page replacement, and stop conversations polling after `reset()`.
