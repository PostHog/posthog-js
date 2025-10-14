---
'posthog-node': minor
---

feat: Add evaluation environments support for feature flags

This PR implements support for evaluation environments in the posthog-node SDK, allowing users to specify which environment tags their SDK instance should use when evaluating feature flags.

Users can now configure the SDK with an `evaluationEnvironments` option:

```typescript
const client = new PostHog('api-key', {
    host: 'https://app.posthog.com',
    evaluationEnvironments: ['production', 'backend', 'api'],
})
```

When set, only feature flags that have at least one matching evaluation tag will be evaluated for this SDK instance. Feature flags with no evaluation tags will always be evaluated.
