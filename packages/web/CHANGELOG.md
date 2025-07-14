# Next

# 4.1.0 - 2025-06-12

1. chore: use `/flags?v=2&config=true` instead of `/decide?v=4` for the flag evaluation backend

# 4.0.0 - 2025-06-10

## Removed

1. Remove `captureMode` in favor of `json` capture mode only
2. Remove deprecated `personProperties` and `groupProperties` in favor of `setPersonPropertiesForFlags` and `setGroupPropertiesForFlags`

# 3.6.0 – 2025-06-05

## Added

1. chore: improve event prop types
2. rotate session id if expired after 24 hours

# 3.5.1 – 2025-05-06

## Fixed

1. Fix exported file extensions to work with older Node versions

# 3.5.0 – 2025-04-17

## Added

1. chore: roll out new flag evaluation backend to majority of customers

# 3.4.2 - 2025-02-27

## Added

1. Added `captureHistoryEvents` option to automatically capture navigation events in single-page applications using the History API.

## Fixed

1. apiKey cannot be empty.

# 3.4.2 - 2025-02-27

## Fixed

1. Supports gracefully handling quotaLimited responses from the PostHog API for feature flags.

# 3.4.1 - 2025-02-20

## Fixed

1. fix: handle cases when non Error is passed to `captureException`

# 3.4.0 - 2025-02-20

## Added

1. Adds the ability to capture user feedback in LLM Observability using the `captureTraceFeedback` and `captureTraceMetric` methods.

# 3.3.0 - 2025-02-06

## Added

1. Adds `captureException` function to allow manual capture of exceptions

# 3.2.1 - 2025-01-17

## Fixed

1. fix: check if window and fetch are available before using on web env

# 3.2.0 - 2024-12-12

## Changed

1. Add new debugging property `$feature_flag_bootstrapped_response`, `$feature_flag_bootstrapped_payload` and `$used_bootstrap_value` to `$feature_flag_called` event

# 3.1.0 - 2024-11-21

## Changed

1. chore: default `captureMode` changed to `json`.
   1. To keep using the `form` mode, just set the `captureMode` option to `form` when initializing the PostHog client.
2. fix: identify method allows passing a $set_once object

# 3.0.2 - 2024-06-15

## Fixed

1. Fixed and error that prevented localstorage from ever being used and instead falling back to sessionstorage for persistence

## Changed

1. chore: change host to new address.

# 3.0.1 - 2024-04-25

1. Prevent double JSON parsing of feature flag payloads, which would convert the payload [1] into 1.

# 3.0.0 - 2024-03-18

## Added

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

# 3.0.0-beta.2 - 2024-03-12

1. `flushAsync` and `shutdownAsync` are removed with `flush` and `shutdown` now being the async methods.
2. Fixed an issue where `shutdownAsync` would potentially exit early if a flush was already in progress
3. Flushes will now try to flush up to `maxBatchSize` (default 100) in one go

# 3.0.0-beta.1 - 2024-03-04

1. Removes the `enable` option. You can now specify `defaultOptIn: false` to start the SDK opted out of tracking
2. Adds a `disabled` option and the ability to change it later via `posthog.disabled = true`. Useful for disabling PostHog tracking for example in a testing environment without having complex conditional checking
3. Many methods such as `capture` and `identify` no longer return the `this` object instead returning nothing
4. Fixes some typos in types
5. `shutdown` and `shutdownAsync` takes a `shutdownTimeoutMs` param with a default of 30000 (30s). This is the time to wait for flushing events before shutting down the client. If the timeout is reached, the client will be shut down regardless of pending events.
6. Adds a new `featureFlagsRequestTimeoutMs` timeout parameter for feature flags which defaults to 10 seconds.

# 2.6.2 - 2024-02-15

1. fix: using `captureMode=form` won't throw an error and retry unnecessarily

# 2.6.1 - 2024-02-06

1. Swapped to `uuidv7` for unique ID generation

# 2.6.0 - 2024-01-18

1. Adds support for overriding the event `uuid` via capture options

# 2.5.0 - 2023-12-04

1. Renamed `personProperties` to `setPersonPropertiesForFlags` to match `posthog-js` and more clearly indicated what it does
2. Renamed `groupProperties` to `setGroupPropertiesForFlags` to match `posthog-js` and more clearly indicated what it does

# 2.4.0 - 2023-04-20

1. Fixes a race condition that could occur when initialising PostHog
2. Fixes an issue where feature flags would not be reloaded after a reset

# 2.3.0 - 2023-04-19

1. Some small fixes to incorrect types
2. Fixed fetch compatibility by aligning error handling
3. Added two errors: PostHogFetchHttpError (non-2xx status) and PostHogFetchNetworkError (fetch network error)
4. Added .on('error', (err) => void)
5. shutdownAsync now ignores fetch errors. They should be handled with .on('error', ...) from now on.

# 2.2.1 - 2023-02-13

1. Fixes an issue where background network errors would trigger unhandled promise warnings

# 2.2.0 - 2023-02-02

1. Adds support for overriding timestamp of capture events

# 2.1.0 - 2022-1-26

1. uses v3 decide endpoint
2. JSON payloads will be returned with feature flags
3. Feature flags will gracefully fail and optimistically save evaluated flags if server is down

# 2.0.1 - 2023-01-25

1. Ensures the distinctId used in `.groupIdentify` is the same as the currently identified user
