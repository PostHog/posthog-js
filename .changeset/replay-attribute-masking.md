---
'posthog-js': minor
'@posthog/types': minor
'@posthog/browser-common': minor
---

Add attribute-level masking to session replay: `maskAttributeFn` provides per-attribute control over the final serialized value, while `maskAllElementAttributes` masks all source DOM string attributes (including rendering attributes and synthesized form values) at the cost of replay fidelity.
