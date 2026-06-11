# Changes from posthog-js v1

This package was seeded from `posthog-js` v1.386.0 (`packages/browser`). This document is the running inventory of intentional breaking changes and will become the seed of the v1 → v2 migration guide.

Wire protocol (event `$properties`, request payload shapes, query params) and persisted storage keys are unchanged — v2 talks to PostHog exactly like v1 does.

## Removed: deprecated surface

### Methods and properties

| v1 | v2 replacement |
| --- | --- |
| `posthog.people.set()` / `set_once()` | `setPersonProperties()` |
| `posthog.decideEndpointWasHit` | `flagsEndpointWasHit` |
| `posthog._calculate_event_properties()` | `calculateEventProperties()` |
| `posthog.getFeatureFlagPayload()` | `getFeatureFlagResult()?.payload` |
| `posthog.renderSurvey()` | `displaySurvey()` |
| `posthog.canRenderSurvey()` | `canRenderSurveyAsync()` |
| `posthog.webPerformance` | (removed; compat shim only) |
| `featureFlags.getFeatureFlagPayload()` | `getFeatureFlagResult()?.payload` |
| `featureFlags.override()` | `featureFlags.overrideFeatureFlags()` |
| `toolbar._loadEditor()` / `maybeLoadEditor()` | `loadToolbar()` / `maybeLoadToolbar()` |
| `sessionRecording.onRRwebEmit()` (public alias) | (internal) |

### Config keys

Removed along with the legacy alias mechanism (`CONFIG_RENAMES`); the modern key is the only spelling:

| Removed | Use instead |
| --- | --- |
| `sanitize_properties` | `beforeSend` |
| `ip` | (no effect; the `ip=0` query param is now hardcoded) |
| `on_xhr_error` | `onRequestError` |
| `xhr_headers` | `requestHeaders` |
| `process_person` | `personProfiles` |
| `advanced_disable_decide` | `advancedDisableFlags` |
| `cookie_name` | `persistenceName` |
| `disable_cookie` | `disablePersistence` |
| `store_google` | `saveCampaignParams` |
| `verbose` | `debug` |
| `property_blacklist` | `propertyDenylist` |
| `__preview_disable_beacon` | `disableBeacon` |
| `__preview_external_dependency_versioned_paths` | `strictScriptVersioning` |

### Window globals

Removed legacy globals; the `__PosthogExtensions__` contract is the only path: `window.rrweb`, `window.rrwebConsoleRecord`, `window.getRecordNetworkPlugin`, `window.posthogErrorWrappingFunctions`, `window.postHogWebVitalsCallbacks`, `window.postHogTracingHeadersPatchFns`, `window.extendPostHogWithSurveys`, `window.ph_load_editor`.

### Survey/toolbar types

`SurveyAppearance.descriptionTextColor`, `SurveyAppearance.inputBackgroundColor` (→ `inputBackground`), `ActionStepType.tag_name` (→ `selector`), `SurveyConfig.autoSubmitIfComplete`, `SurveyConfig.autoSubmitDelay`, `RemoteConfig.editorParams` (→ `toolbarParams`), `RemoteConfig.toolbarVersion`.

## Renamed: methods (snake_case → camelCase)

| v1 | v2 |
| --- | --- |
| `get_distinct_id()` | `getDistinctId()` |
| `get_session_id()` | `getSessionId()` |
| `get_session_replay_url()` | `getSessionReplayUrl()` |
| `get_property()` | `getProperty()` |
| `set_config()` | `setConfig()` |
| `register_once()` | `registerOnce()` |
| `register_for_session()` | `registerForSession()` |
| `unregister_for_session()` | `unregisterForSession()` |
| `opt_in_capturing()` | `optInCapturing()` |
| `opt_out_capturing()` | `optOutCapturing()` |
| `has_opted_in_capturing()` | `hasOptedInCapturing()` |
| `has_opted_out_capturing()` | `hasOptedOutCapturing()` |
| `get_explicit_consent_status()` | `getExplicitConsentStatus()` |
| `clear_opt_in_out_capturing()` | `clearOptInOutCapturing()` |
| `is_capturing()` | `isCapturing()` |
| `init_from_snippet()` / `init_as_module()` | `initFromSnippet()` / `initAsModule()` |

`PostHogPersistence` methods were renamed the same way (`get_property` → `getProperty`, `update_config` → `updateConfig`, etc.). These are internal but technically reachable.

## Renamed: config keys (snake_case → camelCase)

All 85 non-deprecated top-level `PostHogConfig` keys, mechanically: `api_host` → `apiHost`, `capture_pageview` → `capturePageview`, `session_recording` → `sessionRecording`, `before_send` → `beforeSend`, `person_profiles` → `personProfiles`, `opt_out_capturing_by_default` → `optOutCapturingByDefault`, `feature_flag_request_timeout_ms` → `featureFlagRequestTimeoutMs`, `__preview_deferred_init_extensions` → `__previewDeferredInitExtensions`, and so on. The full map is the `SnakeToCamelCase` mapped type in `src/types.ts`.

Not yet renamed (deliberately):

- **Nested option-object keys** (e.g. `capturePerformance.network_timing`, `sessionRecording.session_idle_threshold_ms`, `requestQueueConfig.flush_interval_ms`): follow-up pass.

## Removed: legacy and concluded-experiment config keys

| Removed | Use instead |
| --- | --- |
| `evaluation_environments` | `evaluationContexts` |
| `enable_heatmaps` | `captureHeatmaps` |
| `opt_out_capturing_cookie_prefix` | `consentPersistenceName` (full storage key, not a prefix — the token is no longer appended) |
| `_onCapture` | `beforeSend` |
| `__add_tracing_headers`, `addTracingHeaders` | `tracingHeaders` |
| `api_method`, `inapp_protocol`, `inapp_link_new_window` | (v1 fossils, nothing read them) |
| `__preview_flags_v2`, `__preview_eager_load_replay`, `__preview_lazy_load_replay`, `__preview_disable_xhr_credentials` | (concluded experiments, nothing read them) |
| `__preview_cookie_wins_on_conflict` | (now the only behavior: the cross-subdomain cookie wins over stale localStorage on merge) |
| `__preview_capture_bot_pageviews` | (removed; bot events are always dropped unless `optOutUseragentFilter` is set — `$bot_pageview` routing is gone) |
| `defaults` | (removed; v2 always uses the latest defaults — see below) |

## Changed defaults (`defaults` version-gating collapsed)

v1 staged new default behaviors behind the `defaults: '<date>'` option. v2 bakes the latest in unconditionally; each remains overridable via its own config key:

| Key | v2 default (was, with `defaults: 'unset'`) |
| --- | --- |
| `capturePageview` | `'history_change'` (was `true`) — SPA navigations captured by default |
| `rageclick` | `{ content_ignorelist: ..., ignore_text_selection: true }` (was `true`) |
| `sessionRecording` | `{ strictMinimumDuration: true }` (was `{}`) |
| `externalScriptsInjectTarget` | `'head'` (was `'body'`) |
| `internalOrTestUserHostname` | `/^(localhost\|127\.0\.0\.1)$/` (was `undefined`) |
| `persistenceSaveDebounceMs` | `250` (was `0`) |
| `splitStorage` | `true` (was `false`) |
| `detectGoogleSearchApp` | `true` (was `false`) |

The `$config_defaults` event property is still sent, with the constant value `'v2'`.

## Wire-protocol fields that look like config keys (do not rename)

- `evaluation_contexts`, `flag_keys`: flags request body fields (`posthog-featureflags.ts`).
- `identity_distinct_id`, `identity_hash`: conversations payload/query fields (`extensions/conversations/external/index.tsx`).
