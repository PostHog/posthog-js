---
'posthog-js': minor
---

feat(flags): add updateFlags() method for injecting flags without network request

Adds `posthog.updateFlags(flags, payloads?, options?)` to inject feature flag values from an external source (e.g., server-side evaluation, edge middleware) without making a network request. Supports `{ merge: true }` option to merge with existing flags instead of replacing.