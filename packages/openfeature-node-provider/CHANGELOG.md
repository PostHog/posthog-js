# @posthog/openfeature-node-provider

## 0.1.1

### Patch Changes

- [#4785](https://github.com/PostHog/posthog-js/pull/4785) [`74ca945`](https://github.com/PostHog/posthog-js/commit/74ca9458a166b0a5a9f707e74b1a2e6e2852c829) Thanks [@marandaneto](https://github.com/marandaneto)! - Clarify feature flag return-value terminology across SDK APIs. A `false` value is a conclusive off evaluation, while `undefined` means no evaluation is available. Remote evaluation omits globally inactive flags, whereas backend local evaluation can resolve cached inactive definitions to `false`.
  (2026-09-07)
- Updated dependencies [[`74ca945`](https://github.com/PostHog/posthog-js/commit/74ca9458a166b0a5a9f707e74b1a2e6e2852c829)]:
  - posthog-node@5.51.7

## 0.1.0

### Minor Changes

- [#3994](https://github.com/PostHog/posthog-js/pull/3994) [`759b66f`](https://github.com/PostHog/posthog-js/commit/759b66fdcf7377f5c836429b73f67e5056f00c42) Thanks [@gustavohstrassburger](https://github.com/gustavohstrassburger)! - Initial release of the official PostHog provider for the OpenFeature server SDK, backed by `posthog-node`.
  (2026-07-09)
