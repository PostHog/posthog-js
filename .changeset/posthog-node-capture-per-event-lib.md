---
'posthog-node': major
---

Events send `$lib` and `$lib_version` in their properties again: a `$lib` set on the event, in context or with `register()` wins over the SDK's own pair, and `before_send` can change or remove them.
