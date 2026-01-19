---
'@posthog/core': minor
'posthog-node': minor
'posthog-js': minor
'@posthog/react': minor
'posthog-react-native': minor
---

Renamed `evaluationEnvironments` to `evaluationContexts` for clearer semantics. The term "contexts" better reflects that this feature is for specifying evaluation contexts (e.g., "web", "mobile", "checkout") rather than deployment environments (e.g., "staging", "production").

### Deprecated

- `posthog.init` option `evaluationEnvironments` is now deprecated in favor of `evaluationContexts`. The old property will continue to work and will log a deprecation warning. It will be removed in a future major version.

### Migration Guide

```javascript
// Before
posthog.init('<ph_project_api_key>', {
    evaluationEnvironments: ['production', 'web', 'checkout'],
})

// After
posthog.init('<ph_project_api_key>', {
    evaluationContexts: ['production', 'web', 'checkout'],
})
```
