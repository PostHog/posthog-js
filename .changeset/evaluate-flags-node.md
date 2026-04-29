---
'posthog-node': minor
---

Add `evaluateFlags()` and a new `flags` option on `capture()` so a single `/flags` request powers both flag branching and event enrichment per incoming request:

```ts
const flags = await posthog.evaluateFlags(distinctId, { personProperties: { plan: 'enterprise' } })
if (flags.isEnabled('new-dashboard')) {
  renderNewDashboard()
}
posthog.capture({ distinctId, event: 'page_viewed', flags })
```

The returned `FeatureFlagEvaluations` snapshot exposes `isEnabled()`, `getFlag()`, `getFlagPayload()` for branching, plus `onlyAccessed()` and `only([keys])` for filtering which flags get attached to a captured event. Pass `flagKeys: [...]` to `evaluateFlags()` to scope the underlying `/flags` request itself. `captureException()` / `captureExceptionImmediate()` accept a `flags` argument so `$exception` events carry the same flag context as the rest of your request's events.

Deprecates `isFeatureEnabled()`, `getFeatureFlag()`, `getFeatureFlagPayload()`, and `capture({ sendFeatureFlags })`. They continue to work but now log a deduped `[PostHog] ... is deprecated` warning the first time they're used. Removal is planned for the next major version.
