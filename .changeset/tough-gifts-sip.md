---
'@posthog/core': minor
'posthog-node': minor
'posthog-js': minor
'@posthog/react': minor
'posthog-react-native': minor
---

Renamed `evaluationEnvironments` to `evaluationContexts` for clearer semantics. The term "contexts" better reflects that this feature is for specifying evaluation contexts (e.g., "web", "mobile", "checkout") rather than deployment environments (e.g., "staging", "production").
