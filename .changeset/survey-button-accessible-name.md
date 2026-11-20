---
'@posthog/browser-common': patch
'posthog-js': patch
---

Name survey buttons by their visible text instead of a hard-coded English "Submit survey" label, so screen readers and voice control match the configured or translated button text. Tests that find the button by the name "Submit survey" need to use the visible button text or the `.form-submit` class instead.
