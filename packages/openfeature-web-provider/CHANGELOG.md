# @posthog/openfeature-web-provider

## 0.1.1

### Patch Changes

- [#4785](https://github.com/PostHog/posthog-js/pull/4785) [`74ca945`](https://github.com/PostHog/posthog-js/commit/74ca9458a166b0a5a9f707e74b1a2e6e2852c829) Thanks [@marandaneto](https://github.com/marandaneto)! - Clarify feature flag return-value terminology across SDK APIs. A `false` value is a conclusive off evaluation, while `undefined` means no evaluation is available. Remote evaluation omits globally inactive flags, whereas backend local evaluation can resolve cached inactive definitions to `false`.
  (2026-09-07)
- Updated dependencies [[`c207020`](https://github.com/PostHog/posthog-js/commit/c20702023ed05de61799e4d186b7dd1d040ce251), [`74ca945`](https://github.com/PostHog/posthog-js/commit/74ca9458a166b0a5a9f707e74b1a2e6e2852c829), [`fd4ece8`](https://github.com/PostHog/posthog-js/commit/fd4ece8db1aa313f09724a747e4d450ecdc77da2), [`d73455e`](https://github.com/PostHog/posthog-js/commit/d73455e470822483abbf0e0a20bb3c8fa1bc6e2e), [`95b159a`](https://github.com/PostHog/posthog-js/commit/95b159a6491c29de87ca0aaf5ea40c787cf0518d), [`24f1937`](https://github.com/PostHog/posthog-js/commit/24f193719a7d87a2b66591c3ab903031bbea62a6), [`5e74132`](https://github.com/PostHog/posthog-js/commit/5e74132a76a32d5df9c6706dddf1597c748061d2), [`21dcebd`](https://github.com/PostHog/posthog-js/commit/21dcebd3361a2fe24b022601b8131ae85a3f077d)]:
  - posthog-js@1.427.3

## 0.1.0

### Minor Changes

- [#4069](https://github.com/PostHog/posthog-js/pull/4069) [`781ea3b`](https://github.com/PostHog/posthog-js/commit/781ea3b8232db48a4a5ab399f2150bb512a5887b) Thanks [@gustavohstrassburger](https://github.com/gustavohstrassburger)! - Initial release of the official PostHog provider for the OpenFeature web SDK, backed by `posthog-js`.
  (2026-07-06)

### Patch Changes

- Updated dependencies [[`ef119bf`](https://github.com/PostHog/posthog-js/commit/ef119bfbc4d39a9b10a6a774ca987c3fbac12519)]:
  - posthog-js@1.398.0
