# posthog-js-lite

## 4.4.7

### Patch Changes

- Updated dependencies [[`bb62809`](https://github.com/PostHog/posthog-js/commit/bb62809917845685ae7e2e6d5adad6be5528356e)]:
  - @posthog/core@1.20.0

## 4.4.6

### Patch Changes

- Updated dependencies [[`c99e5fe`](https://github.com/PostHog/posthog-js/commit/c99e5feb043870357c8f722eb52542327c3f472b)]:
  - @posthog/core@1.19.0

## 4.4.5

### Patch Changes

- Updated dependencies [[`7768010`](https://github.com/PostHog/posthog-js/commit/77680105f1e8baf5ed1934d423494793d11ff01a)]:
  - @posthog/core@1.18.0

## 4.4.4

### Patch Changes

- Updated dependencies [[`727536c`](https://github.com/PostHog/posthog-js/commit/727536cf5f1ab5a8d21fa9d4e2e6b13efc851fca)]:
  - @posthog/core@1.17.0

## 4.4.3

### Patch Changes

- Updated dependencies [[`cbe84c1`](https://github.com/PostHog/posthog-js/commit/cbe84c1ea8b6dd398569ed401139e9698e08fd64)]:
  - @posthog/core@1.16.0

## 4.4.2

### Patch Changes

- Updated dependencies [[`8c0c495`](https://github.com/PostHog/posthog-js/commit/8c0c495caaf4cd7f950cbc77fdfc1df499772008)]:
  - @posthog/core@1.15.0

## 4.4.1

### Patch Changes

- [#2971](https://github.com/PostHog/posthog-js/pull/2971) [`f51560c`](https://github.com/PostHog/posthog-js/commit/f51560caf78386cef5278f7cf0e9f253b2ec0e50) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: groups and groupidentify is a no-op if person profiles is set to never
  (2026-01-27)
- Updated dependencies [[`f51560c`](https://github.com/PostHog/posthog-js/commit/f51560caf78386cef5278f7cf0e9f253b2ec0e50)]:
  - @posthog/core@1.14.1

## 4.4.0

### Minor Changes

- [#2917](https://github.com/PostHog/posthog-js/pull/2917) [`933c763`](https://github.com/PostHog/posthog-js/commit/933c7639ae30390ca562a0891d59649711b53522) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: add support for person_profiles react native, core and web-lite
  (2026-01-23)

### Patch Changes

- Updated dependencies [[`933c763`](https://github.com/PostHog/posthog-js/commit/933c7639ae30390ca562a0891d59649711b53522)]:
  - @posthog/core@1.14.0

## 4.3.1

### Patch Changes

- Updated dependencies [[`8a5a3d5`](https://github.com/PostHog/posthog-js/commit/8a5a3d5693facda62b90b66dead338f7dca19705)]:
  - @posthog/core@1.13.0

## 4.3.0

### Minor Changes

- [#2931](https://github.com/PostHog/posthog-js/pull/2931) [`f0cbc0d`](https://github.com/PostHog/posthog-js/commit/f0cbc0d8e4e5efc27d9595676e886d6d3d3892f4) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: before_send support for web lite and react native
  (2026-01-20)

### Patch Changes

- Updated dependencies [[`b7fa003`](https://github.com/PostHog/posthog-js/commit/b7fa003ef6ef74bdf4666be0748d89a5a6169054), [`f0cbc0d`](https://github.com/PostHog/posthog-js/commit/f0cbc0d8e4e5efc27d9595676e886d6d3d3892f4)]:
  - @posthog/core@1.12.0

## 4.2.8

### Patch Changes

- Updated dependencies [[`23770e9`](https://github.com/PostHog/posthog-js/commit/23770e9e2eed1aca5c2bc7a34a6d64dc115b0d11)]:
  - @posthog/core@1.11.0

## 4.2.7

### Patch Changes

- Updated dependencies [[`d37e570`](https://github.com/PostHog/posthog-js/commit/d37e5709863e869825df57d0854588140c4294b2)]:
  - @posthog/core@1.10.0

## 4.2.6

### Patch Changes

- Updated dependencies [[`fba9fb2`](https://github.com/PostHog/posthog-js/commit/fba9fb2ea4be2ea396730741b4718b4a2c80d026), [`c1ed63b`](https://github.com/PostHog/posthog-js/commit/c1ed63b0f03380a5e4bb2463491b3f767f64a514)]:
  - @posthog/core@1.9.1

## 4.2.5

### Patch Changes

- Updated dependencies [[`b676b4d`](https://github.com/PostHog/posthog-js/commit/b676b4d7342c8c3b64960aa55630b2810366014e)]:
  - @posthog/core@1.9.0

## 4.2.4

### Patch Changes

- Updated dependencies [[`6b0aabf`](https://github.com/PostHog/posthog-js/commit/6b0aabff893e44d1710b7d122a68bf023f4e0bd5)]:
  - @posthog/core@1.8.1

## 4.2.3

### Patch Changes

- Updated dependencies [[`2603a8d`](https://github.com/PostHog/posthog-js/commit/2603a8d6e1021cd8f84e8b61be77ce268435ebde)]:
  - @posthog/core@1.8.0

## 4.2.2

### Patch Changes

- [#2690](https://github.com/PostHog/posthog-js/pull/2690) [`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4) Thanks [@robbie-c](https://github.com/robbie-c)! - Related to https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182

  We didn't include any of the vulnerable deps in any of our packages, however we did have them as dev / test / example project dependencies.

  There was no way that any of these vulnerable packages were included in any of our published packages.

  We've now patched out those dependencies.

  Out of an abundance of caution, let's create a new release of all of our packages. (2025-12-04)

- Updated dependencies [[`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4)]:
  - @posthog/core@1.7.1

## 4.2.1

### Patch Changes

- Updated dependencies [[`e1617d9`](https://github.com/PostHog/posthog-js/commit/e1617d91255b23dc39b1dcb15b05ae64c735d9d0)]:
  - @posthog/core@1.7.0

## 4.2.0

### Minor Changes

- [#2619](https://github.com/PostHog/posthog-js/pull/2619) [`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86) Thanks [@hpouillot](https://github.com/hpouillot)! - package deprecation
  (2025-11-24)

### Patch Changes

- Updated dependencies [[`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86)]:
  - @posthog/core@1.6.0

## 4.1.14

### Patch Changes

- [#2618](https://github.com/PostHog/posthog-js/pull/2618) [`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe) Thanks [@marandaneto](https://github.com/marandaneto)! - last version was compromised
  (2025-11-24)
- Updated dependencies [[`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe)]:
  - @posthog/core@1.5.6

## 4.1.13

### Patch Changes

- Updated dependencies [[`83f5d07`](https://github.com/PostHog/posthog-js/commit/83f5d07e4ae8c2ae5c6926858b6095ebbfaf319f)]:
  - @posthog/core@1.5.5

## 4.1.12

### Patch Changes

- Updated dependencies [[`c242702`](https://github.com/PostHog/posthog-js/commit/c2427029d75cba71b78e9822f18f5e73f7442288)]:
  - @posthog/core@1.5.4

## 4.1.11

### Patch Changes

- Updated dependencies [[`8acd88f`](https://github.com/PostHog/posthog-js/commit/8acd88f1b71d2c7e1222c43dd121abce78ef2bab)]:
  - @posthog/core@1.5.3

## 4.1.10

### Patch Changes

- Updated dependencies [[`87f9604`](https://github.com/PostHog/posthog-js/commit/87f96047739e67b847fe22137b97fc57f405b8d9)]:
  - @posthog/core@1.5.2

## 4.1.9

### Patch Changes

- Updated dependencies [[`d8d98c9`](https://github.com/PostHog/posthog-js/commit/d8d98c95f24b612110dbf52d228c0c3bd248cd58)]:
  - @posthog/core@1.5.1

## 4.1.8

### Patch Changes

- Updated dependencies [[`068d55e`](https://github.com/PostHog/posthog-js/commit/068d55ed4193e82729cd34b42d9e433f85b6e606)]:
  - @posthog/core@1.5.0

## 4.1.7

### Patch Changes

- Updated dependencies [[`751b440`](https://github.com/PostHog/posthog-js/commit/751b44040c4c0c55a19df2ad0e5f215943620e51)]:
  - @posthog/core@1.4.0

## 4.1.6

### Patch Changes

- Updated dependencies [[`e0a6fe0`](https://github.com/PostHog/posthog-js/commit/e0a6fe013b5a1e92a6e7685f35f715199b716b34)]:
  - @posthog/core@1.3.1

## 4.1.5

### Patch Changes

- Updated dependencies [[`daf919b`](https://github.com/PostHog/posthog-js/commit/daf919be225527ee4ad026d806dec195b75e44aa), [`7d45a7a`](https://github.com/PostHog/posthog-js/commit/7d45a7a52c44ba768913d66a4c4363d107042682)]:
  - @posthog/core@1.3.0

## 4.1.4

### Patch Changes

- Updated dependencies [[`10da2ee`](https://github.com/PostHog/posthog-js/commit/10da2ee0b8862ad0e32b68e452fae1bc77620bbf)]:
  - @posthog/core@1.2.4

## 4.1.3

### Patch Changes

- Updated dependencies [[`e19a384`](https://github.com/PostHog/posthog-js/commit/e19a384468d722c12f4ef21feb684da31f9dcd3b)]:
  - @posthog/core@1.2.3

## 4.1.2

### Patch Changes

- [#2403](https://github.com/PostHog/posthog-js/pull/2403) [`162aa86`](https://github.com/PostHog/posthog-js/commit/162aa86bf296dc3046ee7ed6166b94e77e422805) Thanks [@hpouillot](https://github.com/hpouillot)! - fix core dependency

## 4.1.1

### Patch Changes

- [#2219](https://github.com/PostHog/posthog-js/pull/2219) [`44d10c4`](https://github.com/PostHog/posthog-js/commit/44d10c46c5378fa046320b7c50bd046eb1e75994) Thanks [@daibhin](https://github.com/daibhin)! - update @posthog/core

## 4.1.0 - 2025-06-12

1. chore: use `/flags?v=2&config=true` instead of `/decide?v=4` for the flag evaluation backend

## 4.0.0 - 2025-06-10

### Breaking changes

1. PostHog Web now compresses messages with GZip before sending them to our servers when the runtime supports compression. This reduces network bandwidth and improves performance. Network traffic interceptors and test assertions on payloads must handle GZip decompression to inspect the data. Alternatively, you can disable compression by setting `disableCompression: true` in the client configuration during tests.

### Removed

1. Remove `captureMode` in favor of `json` capture mode only
2. Remove deprecated `personProperties` and `groupProperties` in favor of `setPersonPropertiesForFlags` and `setGroupPropertiesForFlags`

## 3.6.0 – 2025-06-05

### Added

1. chore: improve event prop types
2. rotate session id if expired after 24 hours

## 3.5.1 – 2025-05-06

### Fixed

1. Fix exported file extensions to work with older Node versions

## 3.5.0 – 2025-04-17

### Added

1. chore: roll out new flag evaluation backend to majority of customers

## 3.4.2 - 2025-02-27

### Added

1. Added `captureHistoryEvents` option to automatically capture navigation events in single-page applications using the History API.

### Fixed

1. apiKey cannot be empty.

## 3.4.2 - 2025-02-27

### Fixed

1. Supports gracefully handling quotaLimited responses from the PostHog API for feature flags.

## 3.4.1 - 2025-02-20

### Fixed

1. fix: handle cases when non Error is passed to `captureException`

## 3.4.0 - 2025-02-20

### Added

1. Adds the ability to capture user feedback in LLM Observability using the `captureTraceFeedback` and `captureTraceMetric` methods.

## 3.3.0 - 2025-02-06

### Added

1. Adds `captureException` function to allow manual capture of exceptions

## 3.2.1 - 2025-01-17

### Fixed

1. fix: check if window and fetch are available before using on web env

## 3.2.0 - 2024-12-12

### Changed

1. Add new debugging property `$feature_flag_bootstrapped_response`, `$feature_flag_bootstrapped_payload` and `$used_bootstrap_value` to `$feature_flag_called` event

## 3.1.0 - 2024-11-21

### Changed

1. chore: default `captureMode` changed to `json`.
   1. To keep using the `form` mode, just set the `captureMode` option to `form` when initializing the PostHog client.
2. fix: identify method allows passing a $set_once object

## 3.0.2 - 2024-06-15

### Fixed

1. Fixed and error that prevented localstorage from ever being used and instead falling back to sessionstorage for persistence

## Changed

1. chore: change host to new address.

## 3.0.1 - 2024-04-25

1. Prevent double JSON parsing of feature flag payloads, which would convert the payload [1] into 1.

## 3.0.0 - 2024-03-18

### Added

1. Adds a `disabled` option and the ability to change it later via `posthog.disabled = true`. Useful for disabling PostHog tracking for example in a testing environment without having complex conditional checking
2. `shutdown` takes a `shutdownTimeoutMs` param with a default of 30000 (30s). This is the time to wait for flushing events before shutting down the client. If the timeout is reached, the client will be shut down regardless of pending events.
3. Adds a new `featureFlagsRequestTimeoutMs` timeout parameter for feature flags which defaults to 10 seconds.
4. Flushes will now try to flush up to `maxBatchSize` (default 100) in one go
5. Queued events are limited up to `maxQueueSize` (default 1000) and the oldest events are dropped when the limit is reached

## Removed

1. Removes the `enable` option. You can now specify `defaultOptIn: false` to start the SDK opted out of tracking
2. `flushAsync` and `shutdownAsync` are removed with `flush` and `shutdown` now being the async methods.

## Changed

1. `flush` and `shutdown` now being async methods.
2. Many methods such as `capture` and `identify` no longer return the `this` object instead returning nothing

## Fixed

1. Fixed an issue where `shutdown` would potentially exit early if a flush was already in progress
2. Fixes some typos in types

## 3.0.0-beta.2 - 2024-03-12

1. `flushAsync` and `shutdownAsync` are removed with `flush` and `shutdown` now being the async methods.
2. Fixed an issue where `shutdownAsync` would potentially exit early if a flush was already in progress
3. Flushes will now try to flush up to `maxBatchSize` (default 100) in one go

## 3.0.0-beta.1 - 2024-03-04

1. Removes the `enable` option. You can now specify `defaultOptIn: false` to start the SDK opted out of tracking
2. Adds a `disabled` option and the ability to change it later via `posthog.disabled = true`. Useful for disabling PostHog tracking for example in a testing environment without having complex conditional checking
3. Many methods such as `capture` and `identify` no longer return the `this` object instead returning nothing
4. Fixes some typos in types
5. `shutdown` and `shutdownAsync` takes a `shutdownTimeoutMs` param with a default of 30000 (30s). This is the time to wait for flushing events before shutting down the client. If the timeout is reached, the client will be shut down regardless of pending events.
6. Adds a new `featureFlagsRequestTimeoutMs` timeout parameter for feature flags which defaults to 10 seconds.

## 2.6.2 - 2024-02-15

1. fix: using `captureMode=form` won't throw an error and retry unnecessarily

## 2.6.1 - 2024-02-06

1. Swapped to `uuidv7` for unique ID generation

## 2.6.0 - 2024-01-18

1. Adds support for overriding the event `uuid` via capture options

## 2.5.0 - 2023-12-04

1. Renamed `personProperties` to `setPersonPropertiesForFlags` to match `posthog-js` and more clearly indicated what it does
2. Renamed `groupProperties` to `setGroupPropertiesForFlags` to match `posthog-js` and more clearly indicated what it does

## 2.4.0 - 2023-04-20

1. Fixes a race condition that could occur when initialising PostHog
2. Fixes an issue where feature flags would not be reloaded after a reset

## 2.3.0 - 2023-04-19

1. Some small fixes to incorrect types
2. Fixed fetch compatibility by aligning error handling
3. Added two errors: PostHogFetchHttpError (non-2xx status) and PostHogFetchNetworkError (fetch network error)
4. Added .on('error', (err) => void)
5. shutdownAsync now ignores fetch errors. They should be handled with .on('error', ...) from now on.

## 2.2.1 - 2023-02-13

1. Fixes an issue where background network errors would trigger unhandled promise warnings

## 2.2.0 - 2023-02-02

1. Adds support for overriding timestamp of capture events

## 2.1.0 - 2022-1-26

1. uses v3 decide endpoint
2. JSON payloads will be returned with feature flags
3. Feature flags will gracefully fail and optimistically save evaluated flags if server is down

## 2.0.1 - 2023-01-25

1. Ensures the distinctId used in `.groupIdentify` is the same as the currently identified user
