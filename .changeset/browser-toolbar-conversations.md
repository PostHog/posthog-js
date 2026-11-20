---
'@posthog/browser': minor
'@posthog/browser-common': minor
'posthog-js': patch
---

Add toolbar loading and conversations to `@posthog/browser`. In posthog-js, surveys, product tours and conversations render without a stylesheet when `prepare_external_dependency_stylesheet` throws, the toolbar reloads once per Turbolinks page replacement, and conversations stop polling after `reset()`.
