---
'posthog-js': minor
'@posthog/types': minor
---

Add `$input_value` to autocapture `change` events for fields marked `data-ph-capture-value`, or matched by the new `autocapture.capture_value_css_selector_allowlist` option (CSS selectors or an `(element) => boolean` predicate).
