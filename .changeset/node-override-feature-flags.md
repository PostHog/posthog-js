---
"posthog-node": minor
---

feat(node): add overrideFeatureFlags() method for local testing

Adds a new `overrideFeatureFlags()` method to the Node SDK that allows you to override feature flag values locally. This is useful for:
- Local development and testing
- Unit and integration tests without mocking fetch
- E2E tests that need deterministic flag values

Usage:

```typescript
// Clear all overrides
posthog.overrideFeatureFlags(false)

// Enable a list of flags (sets them to true)
posthog.overrideFeatureFlags(['flag-a', 'flag-b'])

// Set specific flag values/variants
posthog.overrideFeatureFlags({ 'my-flag': 'variant-a', 'other-flag': true })

// Set both flags and payloads
posthog.overrideFeatureFlags({
  flags: { 'my-flag': 'variant-a' },
  payloads: { 'my-flag': { discount: 20 } }
})
```

Overridden flags take precedence over both local evaluation and remote evaluation.
