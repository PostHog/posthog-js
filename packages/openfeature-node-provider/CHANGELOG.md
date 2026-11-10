# @posthog/openfeature-node-provider

## 0.1.3

### Patch Changes

- [#5252](https://github.com/PostHog/posthog-js/pull/5252) [`503c3ea`](https://github.com/PostHog/posthog-js/commit/503c3ea1ee79d3ff8c6cce90c9e455a0455af50a) Thanks [@andehen](https://github.com/andehen)! - When `sendFeatureFlagEvents` is not set, follow the posthog-node client's `sendFeatureFlagEvent` option instead of always sending `$feature_flag_called` events.
  (2026-10-28)
- Updated dependencies [[`503c3ea`](https://github.com/PostHog/posthog-js/commit/503c3ea1ee79d3ff8c6cce90c9e455a0455af50a)]:
  - posthog-node@5.59.0

## 0.1.2

### Patch Changes

- [#5099](https://github.com/PostHog/posthog-js/pull/5099) [`e3955f8`](https://github.com/PostHog/posthog-js/commit/e3955f894d583dcda1da41b7580b002db924e552) Thanks [@marandaneto](https://github.com/marandaneto)! - Expose feature flag evaluation reasons and preserve them in OpenFeature resolution metadata.
  (2026-09-25)
- Updated dependencies [[`e3955f8`](https://github.com/PostHog/posthog-js/commit/e3955f894d583dcda1da41b7580b002db924e552)]:
  - posthog-node@5.54.0

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
