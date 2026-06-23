# @posthog/core

## 1.36.0

### Minor Changes

- [#3921](https://github.com/PostHog/posthog-js/pull/3921) [`c28b161`](https://github.com/PostHog/posthog-js/commit/c28b16143d04caade1d024819017b89cef3162ad) Thanks [@marandaneto](https://github.com/marandaneto)! - Add `disable_capture_url_hashes` to strip URL fragments from automatically captured URLs. It is disabled by default for backwards compatibility, and enabled automatically when `config.defaults` is `'2026-06-25'` or later. Enabling it (either explicitly or via the `'2026-06-25'` defaults) is a breaking behavior change for SPAs that rely on URL hashes for routing or analytics, because hash-based routes will be collapsed to the same URL without the fragment in fields such as `$current_url`, `$initial_current_url`, `$session_entry_url`, autocapture `$elements[*].attr__href`, `$external_click_url`, replay `href` URLs, heatmaps, web vitals `$current_url`, logs `url.full`, conversations `current_url`/`request_url`, or Next.js Pages Router `$pageview` `$current_url`.

  If you only want to capture some hashes, leave hash capture enabled and use `before_send` to remove or redact sensitive hash values before events are sent. (2026-06-23)

### Patch Changes

- Updated dependencies [[`c28b161`](https://github.com/PostHog/posthog-js/commit/c28b16143d04caade1d024819017b89cef3162ad)]:
  - @posthog/types@1.391.0

## 1.35.4

### Patch Changes

- [#3895](https://github.com/PostHog/posthog-js/pull/3895) [`ce528ed`](https://github.com/PostHog/posthog-js/commit/ce528ed73936bbefa47f52e90cce8e11bb4205cc) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Console log auto-capture (`logs: { captureConsoleLogs: true }`) now flows through the same pipeline as `posthog.captureLog()`, `posthog.logger.*`, and PostHog's other SDKs, instead of OpenTelemetry. As a result:
  - the bundled OpenTelemetry dependencies are removed, shrinking the lazily-loaded logs chunk
  - auto-captured console logs now run through `logs.beforeSend` (the same hook as `captureLog`/`logger.*`), so you can redact or drop sensitive console output before it's sent. To treat console logs differently from manual logs, branch on the record's `log.source` attribute: auto-captured console logs set it to `console.<method>` (e.g. `console.error`), while manual `captureLog`/`logger.*` logs leave it unset
  - console logs now link to the person's profile: they carry the person id as `posthogDistinctId`, the attribute PostHog uses to associate logs with a person ([docs](https://posthog.com/docs/logs/link-person)). The old path used `distinct_id`, which isn't used for person linking by default, so console logs previously didn't appear on person profiles unless you'd configured a custom key.

  Console logs keep their `posthog-browser-logs` `service.name`, their `console` instrumentation scope, and their `log.source: console.<level>` attribute.

  As part of moving onto the shared pipeline, console records now use PostHog's standard log field names — the same ones programmatic web logs and other SDKs use, and the ones the Logs UI surfaces. For the fields below the **values are unchanged** — only the attribute names/locations differ:
  - `distinct_id` → `posthogDistinctId` (record attribute)
  - `location.href` → `url.full` (record attribute; same value — the page URL)
  - `session.id` (resource attribute) → `sessionId` (record attribute) — renamed and moved
  - `host` and `window.id` move from resource attributes to record attributes (names unchanged)
  - records also now carry the standard SDK context shared by other logs, including `feature_flags`

  For most projects this needs no action — these are already the canonical log fields. The only thing to update is a saved Logs query or dashboard built specifically on an **old** console attribute name, for example:
  - `attributes.distinct_id` → `attributes.posthogDistinctId`
  - `attributes.location.href` → `attributes.url.full`
  - `resource.attributes.session.id` → `attributes.sessionId`
  - `resource.attributes.host` / `resource.attributes.window.id` → `attributes.host` / `attributes.window.id` (2026-06-22)

## 1.35.3

### Patch Changes

- [#3903](https://github.com/PostHog/posthog-js/pull/3903) [`6b21f77`](https://github.com/PostHog/posthog-js/commit/6b21f77291aeea64ce8229eb28196d1acacc20ce) Thanks [@marandaneto](https://github.com/marandaneto)! - Validate custom event UUID overrides and generate new UUIDs when invalid.
  (2026-06-19)
- Updated dependencies [[`6b21f77`](https://github.com/PostHog/posthog-js/commit/6b21f77291aeea64ce8229eb28196d1acacc20ce)]:
  - @posthog/types@1.390.2

## 1.35.2

### Patch Changes

- [#3886](https://github.com/PostHog/posthog-js/pull/3886) [`e6d7fe2`](https://github.com/PostHog/posthog-js/commit/e6d7fe2a5f10d29b3df69392f584970e7a7a4561) Thanks [@marandaneto](https://github.com/marandaneto)! - Stop sending deprecated no-op top-level `type`, `library`, and `library_version` fields in event batch payloads. Use `properties.$lib` and `properties.$lib_version` for SDK metadata; legacy queued `library` and `library_version` values are used as fallbacks when the official `$` properties are missing.
  (2026-06-18)

## 1.35.1

### Patch Changes

- [#3876](https://github.com/PostHog/posthog-js/pull/3876) [`d7b1a03`](https://github.com/PostHog/posthog-js/commit/d7b1a031761cdd6aa8cf6b28f828a2fa29ac0765) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Deprecate `getFeatureFlagPayload` in favor of `getFeatureFlagResult`, which returns the flag value and payload from a single evaluation. `getFeatureFlagPayload` continues to work.
  (2026-06-17)

## 1.35.0

### Minor Changes

- [#3865](https://github.com/PostHog/posthog-js/pull/3865) [`b469830`](https://github.com/PostHog/posthog-js/commit/b469830a308761005c963872c349de5fa4b35f39) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - The browser's programmatic logs API (`posthog.captureLog()` / `posthog.logger.*`) now runs through the shared `@posthog/core` logs pipeline that React Native already uses — no change to the public API or existing behavior. Log delivery is more resilient as a result: oversized batches are split automatically, failed sends retry with exponential backoff, and delivery resumes when the browser comes back online.
  (2026-06-17)

### Patch Changes

- Updated dependencies [[`b469830`](https://github.com/PostHog/posthog-js/commit/b469830a308761005c963872c349de5fa4b35f39)]:
  - @posthog/types@1.389.0

## 1.34.0

### Minor Changes

- [#3848](https://github.com/PostHog/posthog-js/pull/3848) [`bd07ec4`](https://github.com/PostHog/posthog-js/commit/bd07ec42968ada9099a31cf7d61b106af22267ca) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Add a `disableRemoteFeatureFlags` option and a public `updateFlags(flags, payloads?, { merge })` method, for apps that evaluate feature flags outside the SDK (for example on their own backend) and want to supply the results at runtime instead of having the SDK fetch them.

  With `disableRemoteFeatureFlags: true`, the SDK no longer fetches or evaluates feature flags from PostHog — `identify()`, `group()`, and `reset()` stop triggering `/flags` requests — while `getFeatureFlag()` and `getFeatureFlagPayload()` keep working against the values you supply. Provide those values (with optional payloads) at runtime via `updateFlags(flags, payloads?, { merge })`; they persist across restarts. This mirrors the web SDK's `advanced_disable_feature_flags` and `updateFlags`. (2026-06-17)

## 1.33.0

### Minor Changes

- [#3709](https://github.com/PostHog/posthog-js/pull/3709) [`c6c163a`](https://github.com/PostHog/posthog-js/commit/c6c163aefb093d5609977ae243b056f96a2d3b4e) Thanks [@posthog](https://github.com/apps/posthog)! - Add `unsetPersonProperties()` to remove person properties, the counterpart to `setPersonProperties()`. Previously the only way to unset a person property was to hand-pass a `$unset` array inside a `capture()` call.
  (2026-06-16)

### Patch Changes

- [#3756](https://github.com/PostHog/posthog-js/pull/3756) [`b3ec845`](https://github.com/PostHog/posthog-js/commit/b3ec8453d3678bd7ab6737b25bae003e61117ef9) Thanks [@archievi](https://github.com/archievi)! - Drop the event and log a warning when a `before_send` hook removes the `token` property, instead of silently sending an event that ingest rejects with a 401.
  (2026-06-16)
- Updated dependencies [[`c9c7df1`](https://github.com/PostHog/posthog-js/commit/c9c7df1e7f3ae6152aa80f98b49be206fdff1b23), [`c6c163a`](https://github.com/PostHog/posthog-js/commit/c6c163aefb093d5609977ae243b056f96a2d3b4e)]:
  - @posthog/types@1.387.0

## 1.32.5

### Patch Changes

- [#3828](https://github.com/PostHog/posthog-js/pull/3828) [`8464c92`](https://github.com/PostHog/posthog-js/commit/8464c9296d73376701b72075b48ea69e09bc1d9a) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - fix: persist the session replay config from a `/flags` response before emitting the `featureflags` event, so listeners (e.g. React Native session replay linked-flag re-evaluation) read a recording config consistent with the new flag values. This only reorders two adjacent synchronous writes in the stateful core client (used by `posthog-react-native` and `@posthog/web`); the event payload is unchanged, and `posthog-node` and the browser `posthog-js` package do not use this code path.
  (2026-06-15)

## 1.32.4

### Patch Changes

- [#3837](https://github.com/PostHog/posthog-js/pull/3837) [`29bf8e3`](https://github.com/PostHog/posthog-js/commit/29bf8e386a4050531e9cfd906c33b75945fcb6ad) Thanks [@marandaneto](https://github.com/marandaneto)! - Add missing bugs metadata to package manifests.
  (2026-06-15)
- Updated dependencies [[`29bf8e3`](https://github.com/PostHog/posthog-js/commit/29bf8e386a4050531e9cfd906c33b75945fcb6ad)]:
  - @posthog/types@1.386.4

## 1.32.3

### Patch Changes

- Updated dependencies [[`dbf2377`](https://github.com/PostHog/posthog-js/commit/dbf23777e1c14a811c67697684d56145518ebe16)]:
  - @posthog/types@1.386.3

## 1.32.2

### Patch Changes

- [#3799](https://github.com/PostHog/posthog-js/pull/3799) [`25822ac`](https://github.com/PostHog/posthog-js/commit/25822acc0d16f9f1d6fbbd65da57b3e060c6c558) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - fix(logs): when a logs `beforeSend` hook throws, log the error and drop the record (fail closed) instead of continuing the chain and enqueuing it — a buggy redaction hook must not leak an unredacted log record.
  (2026-06-11)
- Updated dependencies []:
  - @posthog/types@1.386.2

## 1.32.1

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.386.1

## 1.32.0

### Minor Changes

- [#3634](https://github.com/PostHog/posthog-js/pull/3634) [`612f97a`](https://github.com/PostHog/posthog-js/commit/612f97adebd3d863602533180ac4bee3f3ed731d) Thanks [@lucasheriques](https://github.com/lucasheriques)! - feat(surveys): add opt-in `appearance.allowGoBack` for multi-question surveys, and make button labels translatable

  Renders a "Back" button on web surveys after the first question. Default is off — existing surveys are unchanged. Uses a visited-index history stack so back-navigation respects branching paths (`response_based`, `specific_question`), and abandoned-branch responses are pruned before submission so analytics aren't polluted. Returning to a question pre-fills the prior answer. `appearance.backButtonText` overrides the default label. The button uses the survey's text color so it stays readable on any background, and it also shows in survey previews.

  Also adds `submitButtonText` and `backButtonText` to survey-level translations, so both the submit and back button labels can be localized via `appearance` translations (previously only the per-question button text was translatable). (2026-06-10)

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.386.0

## 1.31.4

### Patch Changes

- Updated dependencies [[`c11794d`](https://github.com/PostHog/posthog-js/commit/c11794dd5fbb73d99bb88600ae487f8f08f625be), [`f601c49`](https://github.com/PostHog/posthog-js/commit/f601c496338ed0be8853f94160ee3edca542ac7d)]:
  - @posthog/types@1.385.0

## 1.31.3

### Patch Changes

- Updated dependencies [[`2d21ada`](https://github.com/PostHog/posthog-js/commit/2d21ada24479c0d4f561dd3b6f5922ce3f8e4afd)]:
  - @posthog/types@1.384.3

## 1.31.2

### Patch Changes

- Updated dependencies [[`d9462b3`](https://github.com/PostHog/posthog-js/commit/d9462b3567a0b7c9b755552c303814b6fcbe3a97)]:
  - @posthog/types@1.384.2

## 1.31.1

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.384.1

## 1.31.0

### Minor Changes

- [#3782](https://github.com/PostHog/posthog-js/pull/3782) [`0c2acb9`](https://github.com/PostHog/posthog-js/commit/0c2acb9f30d545bb89d1f950ba8f840c76e47dc2) Thanks [@pauldambra](https://github.com/pauldambra)! - Detect the Google Search App (GSA) as its own `$browser` value (`Google Search App`) via the cross-platform `GSA/` UA marker, instead of reporting the embedded webview as Mobile Safari (iOS) or Chrome (Android). Gated behind the new `detect_google_search_app` config option, which the `2026-05-30` config defaults opt into automatically — left off otherwise to keep existing browser attribution backwards-compatible.

  Note: `$browser_version` for `Google Search App` is not comparable across platforms — iOS yields a version like `284.0` (from `GSA/284.0.564099828`) while Android yields a version like `14.21` (from `GSA/14.21.20.28.arm64`), since Google maintains separate versioning schemes for the two apps. Avoid building cross-platform version dashboards on `$browser_version` for this browser. (2026-06-10)

### Patch Changes

- Updated dependencies [[`0c2acb9`](https://github.com/PostHog/posthog-js/commit/0c2acb9f30d545bb89d1f950ba8f840c76e47dc2)]:
  - @posthog/types@1.384.0

## 1.30.14

### Patch Changes

- Updated dependencies [[`783ba46`](https://github.com/PostHog/posthog-js/commit/783ba461b0916c3f379c227d08470687d38d0768)]:
  - @posthog/types@1.383.3

## 1.30.13

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.383.2

## 1.30.12

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.383.1

## 1.30.11

### Patch Changes

- Updated dependencies [[`227c9b0`](https://github.com/PostHog/posthog-js/commit/227c9b03c19dcb93d9a15abb1ee6b9523d366767), [`393f9e2`](https://github.com/PostHog/posthog-js/commit/393f9e2a4697c6ffe52402cad6fb8550b48b5e00)]:
  - @posthog/types@1.383.0

## 1.30.10

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.382.0

## 1.30.9

### Patch Changes

- Updated dependencies [[`a7bd828`](https://github.com/PostHog/posthog-js/commit/a7bd828050d070e1b88eb69c3f9db71c5d08f446)]:
  - @posthog/types@1.381.0

## 1.30.8

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.380.1

## 1.30.7

### Patch Changes

- Updated dependencies [[`2387084`](https://github.com/PostHog/posthog-js/commit/2387084d4d7e28c606a0b0ab23ac0762dcf904d7)]:
  - @posthog/types@1.380.0

## 1.30.6

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.379.3

## 1.30.5

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.379.2

## 1.30.4

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.379.1

## 1.30.3

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.379.0

## 1.30.2

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.378.1

## 1.30.1

### Patch Changes

- Updated dependencies [[`8181354`](https://github.com/PostHog/posthog-js/commit/8181354cae602f3f2b5e8c5b5bcd2e090e25edcc)]:
  - @posthog/types@1.378.0

## 1.30.0

### Minor Changes

- [#3708](https://github.com/PostHog/posthog-js/pull/3708) [`3d4a76f`](https://github.com/PostHog/posthog-js/commit/3d4a76f323ac789df91448fdb05d356dc91bb87f) Thanks [@pauldambra](https://github.com/pauldambra)! - Detect Brave (desktop, Android, iOS), Vivaldi, Yandex, Naver Whale, DuckDuckGo, Pale Moon, and Waterfox so users on these browsers no longer get bucketed as Chrome or Firefox.

  `detectBrowser` / `detectBrowserVersion` now accept an optional third argument, `BrowserDetectionHints`, with a `brave` flag (set when `navigator.brave` exists). The browser SDK populates this automatically to catch desktop / Android Brave, which is Chromium-based and carries no UA marker. Brave on iOS is picked up purely from the `Brave/` UA marker — WebKit doesn't ship `navigator.brave`. The original two-argument signature still works for non-DOM callers. (2026-06-01)

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.377.0

## 1.29.15

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.376.6

## 1.29.14

### Patch Changes

- [#3694](https://github.com/PostHog/posthog-js/pull/3694) [`d9ad199`](https://github.com/PostHog/posthog-js/commit/d9ad1993d320ffc899dd57ce2f1cf1787e9c6635) Thanks [@gustavohstrassburger](https://github.com/gustavohstrassburger)! - fix(react-native): preserve non-string property types (booleans, arrays, numbers, objects) when caching person and group properties for feature flag evaluation. Previously these were force-coerced to strings via `String(value)`, causing flag conditions using boolean equality or array `contains` to fail on device while the PostHog UI still evaluated correctly.
  (2026-05-31)
- Updated dependencies []:
  - @posthog/types@1.376.5

## 1.29.13

### Patch Changes

- [#3681](https://github.com/PostHog/posthog-js/pull/3681) [`7b84b75`](https://github.com/PostHog/posthog-js/commit/7b84b7599d076c9c3c86f923f7d56cf937ad9874) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - unify captureException in posthog core
  (2026-05-28)
- Updated dependencies []:
  - @posthog/types@1.376.4

## 1.29.12

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.376.3

## 1.29.11

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.376.2

## 1.29.10

### Patch Changes

- [#3665](https://github.com/PostHog/posthog-js/pull/3665) [`5568f12`](https://github.com/PostHog/posthog-js/commit/5568f12f46b4ebb7539f261edddda2f695ba03a2) Thanks [@ioannisj](https://github.com/ioannisj)! - Don't autocapture PostHog's own `PostHogFetchNetworkError` (raised when the device is offline) as a `$exception`. These connectivity failures are expected and were flooding error tracking with internal SDK noise. Adds an `isPostHogFetchNetworkError` type guard to `@posthog/core` so SDKs can detect these errors.
  (2026-05-26)
- Updated dependencies []:
  - @posthog/types@1.376.1

## 1.29.9

### Patch Changes

- [#3639](https://github.com/PostHog/posthog-js/pull/3639) [`c806cca`](https://github.com/PostHog/posthog-js/commit/c806ccafdcc39b38e9554f8a17a8c2fbd3361dda) Thanks [@marandaneto](https://github.com/marandaneto)! - Use native async gzip compression for session recording events when CompressionStream is available.
  (2026-05-22)
- Updated dependencies []:
  - @posthog/types@1.376.0

## 1.29.8

### Patch Changes

- Updated dependencies [[`2e1d5f4`](https://github.com/PostHog/posthog-js/commit/2e1d5f4081c98a04e6a16f57e42491911453994d)]:
  - @posthog/types@1.375.0

## 1.29.7

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.374.4

## 1.29.6

### Patch Changes

- [#3581](https://github.com/PostHog/posthog-js/pull/3581) [`a880dbc`](https://github.com/PostHog/posthog-js/commit/a880dbcbbfd01bbef939c627f3b541744e3c3587) Thanks [@Ashut0sh-mishra](https://github.com/Ashut0sh-mishra)! - Detect Oculus Browser (Meta Quest headsets) correctly instead of falling back to Chrome
  (2026-05-20)
- Updated dependencies [[`557b893`](https://github.com/PostHog/posthog-js/commit/557b8934aa0b990184e0376fb1fc28433ad336c6)]:
  - @posthog/types@1.374.3

## 1.29.5

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.374.2

## 1.29.4

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.374.1

## 1.29.3

### Patch Changes

- Updated dependencies [[`594ea11`](https://github.com/PostHog/posthog-js/commit/594ea1146045d49080f6dfd951b037c13278e975)]:
  - @posthog/types@1.374.0

## 1.29.2

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.373.5

## 1.29.1

### Patch Changes

- [#3602](https://github.com/PostHog/posthog-js/pull/3602) [`4b895bf`](https://github.com/PostHog/posthog-js/commit/4b895bf0151f24c0b72e8ce4cae47906795b29b8) Thanks [@marandaneto](https://github.com/marandaneto)! - Validate gzip request bodies at the browser send boundary and fall back to JSON if the outgoing body is not gzip data.
  (2026-05-12)
- Updated dependencies []:
  - @posthog/types@1.373.4

## 1.29.0

### Minor Changes

- [#3599](https://github.com/PostHog/posthog-js/pull/3599) [`ad60818`](https://github.com/PostHog/posthog-js/commit/ad60818222252f1b65bb8778b12862c287168422) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Expose UUID and cookie helpers from `@posthog/core` and `posthog-node` for users managing distinct_id outside the browser SDK (e.g. Lambda functions handing out cross-domain redirects). The helpers were already implemented in `@posthog/next` — this change lifts them to core so all SDKs can re-use them. `@posthog/next` now re-exports the same surface from `@posthog/core` to keep existing consumers working without churn. Closes #2143.
  (2026-05-12)

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.373.3

## 1.28.7

### Patch Changes

- [#3568](https://github.com/PostHog/posthog-js/pull/3568) [`223d925`](https://github.com/PostHog/posthog-js/commit/223d9255e3dfb02af099b7529292cb56854daa77) Thanks [@marandaneto](https://github.com/marandaneto)! - Validate native gzip output before sending requests and fall back when CompressionStream returns malformed data.
  (2026-05-11)
- Updated dependencies []:
  - @posthog/types@1.373.2

## 1.28.6

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.373.1

## 1.28.5

### Patch Changes

- Updated dependencies [[`4c0c7d9`](https://github.com/PostHog/posthog-js/commit/4c0c7d9f48e6f4f5301f8208285191f62dc8407a), [`0a835fa`](https://github.com/PostHog/posthog-js/commit/0a835fa1d5db988d508aa023240ab5b4b50f0969)]:
  - @posthog/types@1.373.0

## 1.28.4

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.10

## 1.28.3

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.9

## 1.28.2

### Patch Changes

- [#3516](https://github.com/PostHog/posthog-js/pull/3516) [`220cd61`](https://github.com/PostHog/posthog-js/commit/220cd61e332ca4982c7bc3b6f740d797ef9e4e7f) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: consume fetch response body to prevent CF Workers runtime warnings
  (2026-05-04)

- [#3515](https://github.com/PostHog/posthog-js/pull/3515) [`255b273`](https://github.com/PostHog/posthog-js/commit/255b27380658b450d1427d4a478e4d7a4bf773f1) Thanks [@marandaneto](https://github.com/marandaneto)! - Gate survey translation logs behind SDK debug logging to avoid production console spam.
  (2026-05-04)
- Updated dependencies []:
  - @posthog/types@1.372.8

## 1.28.1

### Patch Changes

- [#3512](https://github.com/PostHog/posthog-js/pull/3512) [`8aee3d5`](https://github.com/PostHog/posthog-js/commit/8aee3d55f8e2bf7a14a534c940327d8e08ba64f6) Thanks [@marandaneto](https://github.com/marandaneto)! - Do not crash when the React Native SDK is initialized without an API key; initialize as disabled and log an error instead. Disabled clients now also skip manual reload/flush/survey/log network calls.
  (2026-05-04)
- Updated dependencies []:
  - @posthog/types@1.372.7

## 1.28.0

### Minor Changes

- [#3492](https://github.com/PostHog/posthog-js/pull/3492) [`cf56753`](https://github.com/PostHog/posthog-js/commit/cf56753d775225df2751dee2de7987d4a47fef8c) Thanks [@lucasheriques](https://github.com/lucasheriques)! - Add translated survey rendering support in React Native and share survey translation logic through `@posthog/core`.
  (2026-05-01)

- [#3480](https://github.com/PostHog/posthog-js/pull/3480) [`04db756`](https://github.com/PostHog/posthog-js/commit/04db75663208251d1b09c80b09e5d00188e897fd) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Add manual log capture API for React Native: `posthog.captureLog()`, `posthog.logger.{trace,debug,info,warn,error,fatal}()`, `posthog.flushLogs()`, and a `logs` config option on the constructor. Records ship to PostHog's logs product (`/i/v1/logs`) in OTLP format, batched on a timer / AppState change / buffer fill, and persisted to a dedicated logs-storage file.

  Manual capture is unconditional — calling the API ships records, matching the events pipeline's manual `capture()` shape. Only blockers: `optedOut`, missing/empty `body`, and missing API key. The wire field `response.logs.captureConsoleLogs` is browser-only (it gates the JS SDK's `console.*` autocapture extension) and is not read by RN. When console autocapture lands on RN as a follow-up, that PR will introduce a local opt-in for the autocapture path specifically; manual capture will remain unconditional. (2026-05-01)

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.6

## 1.27.9

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.5

## 1.27.8

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.4

## 1.27.7

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.3

## 1.27.6

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.2

## 1.27.5

### Patch Changes

- [#3464](https://github.com/PostHog/posthog-js/pull/3464) [`70508df`](https://github.com/PostHog/posthog-js/commit/70508dfd7dd1201dd9c61c126a3c27ad39311c6a) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Avoid using `Blob.stream()` for native async gzip compression to prevent Safari `NotReadableError` stream failures.
  (2026-04-24)
- Updated dependencies []:
  - @posthog/types@1.372.1

## 1.27.4

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.0

## 1.27.3

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.371.4

## 1.27.2

### Patch Changes

- [#3437](https://github.com/PostHog/posthog-js/pull/3437) [`daf028d`](https://github.com/PostHog/posthog-js/commit/daf028d553f756b9f58c01b848ad2d431239458b) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Disable the core client instead of throwing when the API key is missing, blank, or invalid.
  (2026-04-24)
- Updated dependencies []:
  - @posthog/types@1.371.3

## 1.27.1

### Patch Changes

- [#3453](https://github.com/PostHog/posthog-js/pull/3453) [`96f19b7`](https://github.com/PostHog/posthog-js/commit/96f19b79d563937ed8f98e12796eee541a2dae7f) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Lift OTLP log serialization helpers from posthog-js into @posthog/core so the
  upcoming React Native logs feature consumes the same builders. Browser gains
  two fixes as a side effect: NaN and ±Infinity attribute values no longer get
  silently dropped during JSON encoding, and the scope.version OTLP field is
  now populated with the SDK version (changes the server's instrumentation_scope
  column from "posthog-js@" to "posthog-js@<semver>"). (2026-04-23)
- Updated dependencies [[`96f19b7`](https://github.com/PostHog/posthog-js/commit/96f19b79d563937ed8f98e12796eee541a2dae7f)]:
  - @posthog/types@1.371.2

## 1.27.0

### Minor Changes

- [#3432](https://github.com/PostHog/posthog-js/pull/3432) [`1a8b727`](https://github.com/PostHog/posthog-js/commit/1a8b7277c50a42bbb3f736afd530ff1c3389a7de) Thanks [@richardsolomou](https://github.com/richardsolomou)! - refactor: rename `__add_tracing_headers` to `addTracingHeaders`. The `__` prefix signalled an internal/experimental option, but the config is a public API (documented for linking LLM traces to session replays). `__add_tracing_headers` continues to work as a deprecated alias on the browser SDK.

  Also exposes `patchFetchForTracingHeaders` from `@posthog/core` so non-browser SDKs can reuse the implementation. (2026-04-23)

## 1.26.0

### Minor Changes

- [#3389](https://github.com/PostHog/posthog-js/pull/3389) [`922a1c1`](https://github.com/PostHog/posthog-js/commit/922a1c1838a5ed2ad37f59dade5fc3cc81bb4246) Thanks [@hpouillot](https://github.com/hpouillot)! - Add exception steps to error tracking (aka breadcrumbs)
  (2026-04-22)

## 1.25.3

### Patch Changes

- [#3426](https://github.com/PostHog/posthog-js/pull/3426) [`1a0b58d`](https://github.com/PostHog/posthog-js/commit/1a0b58d1d07c61662169d3bc56eed8cfd8855d65) Thanks [@marandaneto](https://github.com/marandaneto)! - Trim surrounding whitespace from user-provided API keys, personal API keys, and host config values before using them.
  (2026-04-21)

## 1.25.2

### Patch Changes

- [#3351](https://github.com/PostHog/posthog-js/pull/3351) [`c735b08`](https://github.com/PostHog/posthog-js/commit/c735b08577f8fa85935dcec5bc5814870ac4ed56) Thanks [@dmarticus](https://github.com/dmarticus)! - Send $device_id as a top-level field in /flags requests so the feature flags service can use it for device-based bucketing during remote evaluation
  (2026-04-09)

## 1.25.1

### Patch Changes

- [#3340](https://github.com/PostHog/posthog-js/pull/3340) [`57ee5b2`](https://github.com/PostHog/posthog-js/commit/57ee5b25fd2c97f334f52b4eba28ea925033d6ed) Thanks [@dmarticus](https://github.com/dmarticus)! - Add device bucketing support to the React Native SDK for stable feature flag assignment across identity changes
  (2026-04-07)

## 1.25.0

### Minor Changes

- [#3302](https://github.com/PostHog/posthog-js/pull/3302) [`fc5589f`](https://github.com/PostHog/posthog-js/commit/fc5589fcc51bd53ba818822831867d3c00d83a11) Thanks [@dmarticus](https://github.com/dmarticus)! - preserve $set_once semantics in local flag evaluation cache
  (2026-04-07)

## 1.24.6

### Patch Changes

- [#3320](https://github.com/PostHog/posthog-js/pull/3320) [`a01a3d5`](https://github.com/PostHog/posthog-js/commit/a01a3d55dc134b1b269be58c7922ce3780c57fc5) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - fix: send $groupidentify for new groups even when no properties are provided
  (2026-04-02)

## 1.24.5

### Patch Changes

- [#3309](https://github.com/PostHog/posthog-js/pull/3309) [`197eeda`](https://github.com/PostHog/posthog-js/commit/197eeda0b09fd2671a8a40f1bfd48a7b940f7371) Thanks [@marandaneto](https://github.com/marandaneto)! - Extract CLI and sourcemap utilities from @posthog/core into @posthog/plugin-utils to remove cross-spawn from React Native dependencies
  (2026-04-01)

## 1.24.4

### Patch Changes

- [#3296](https://github.com/PostHog/posthog-js/pull/3296) [`a863914`](https://github.com/PostHog/posthog-js/commit/a863914bca09643f2aef7ca029b96de9cbfbc24c) Thanks [@marandaneto](https://github.com/marandaneto)! - Fix `captureException` crashing in React Native with `ReferenceError: Property 'Event' doesn't exist`
  (2026-03-30)

## 1.24.3

### Patch Changes

- [#3292](https://github.com/PostHog/posthog-js/pull/3292) [`4bdfdbc`](https://github.com/PostHog/posthog-js/commit/4bdfdbcfe6a5600664a609a6b17c7d7cb72cd20f) Thanks [@marandaneto](https://github.com/marandaneto)! - Add `@default` JSDoc tags to `PostHogCoreOptions` configuration properties for better IDE documentation and discoverability.
  (2026-03-27)

## 1.24.2

### Patch Changes

- [#3286](https://github.com/PostHog/posthog-js/pull/3286) [`8d34289`](https://github.com/PostHog/posthog-js/commit/8d34289f7cf91945223eed4366b11fb187a63a40) Thanks [@marandaneto](https://github.com/marandaneto)! - Use async native CompressionStream for gzip compression to avoid blocking the main thread
  (2026-03-27)

## 1.24.1

### Patch Changes

- [#3265](https://github.com/PostHog/posthog-js/pull/3265) [`314120a`](https://github.com/PostHog/posthog-js/commit/314120aa2377b3c8031dd774833fe9082ecdbd39) Thanks [@hpouillot](https://github.com/hpouillot)! - fix sourcemap upload with stdin, clean config
  (2026-03-20)

## 1.24.0

### Minor Changes

- [#3246](https://github.com/PostHog/posthog-js/pull/3246) [`9cd2313`](https://github.com/PostHog/posthog-js/commit/9cd23138343e1020811f85853d6016cc985bb24f) Thanks [@hpouillot](https://github.com/hpouillot)! - pipe chunk file path to stdin
  (2026-03-18)

## 1.23.4

### Patch Changes

- [#3236](https://github.com/PostHog/posthog-js/pull/3236) [`bc30c2d`](https://github.com/PostHog/posthog-js/commit/bc30c2d988bb307e811d97711f208c125eefba3a) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - fix: Clean up leaked timers in edge runtimes
  (2026-03-13)

- [#3236](https://github.com/PostHog/posthog-js/pull/3236) [`bc30c2d`](https://github.com/PostHog/posthog-js/commit/bc30c2d988bb307e811d97711f208c125eefba3a) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Omit the config query parameter by default to request only the necessary data
  (2026-03-13)

## 1.23.3

### Patch Changes

- [#3220](https://github.com/PostHog/posthog-js/pull/3220) [`4009c15`](https://github.com/PostHog/posthog-js/commit/4009c15c85c96b5cf99fdbcda448b9893c95541e) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - add better handling for CustomEvent inside unhandled rejections
  (2026-03-11)

## 1.23.2

### Patch Changes

- [#3185](https://github.com/PostHog/posthog-js/pull/3185) [`5e8d5fc`](https://github.com/PostHog/posthog-js/commit/5e8d5fc9c12e5545e015c9c5556167b9fb279347) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: export getRemoteConfigBool, getRemoteConfigNumber, and isValidSampleRate from @posthog/core
  (2026-03-02)

## 1.23.1

### Patch Changes

- [#3107](https://github.com/PostHog/posthog-js/pull/3107) [`9dbc05e`](https://github.com/PostHog/posthog-js/commit/9dbc05ed65ddc8c37c9262b9aebfc51d0c748971) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - warning on manual capture('$exception')
  (2026-02-18)

## 1.23.0

### Minor Changes

- [#3086](https://github.com/PostHog/posthog-js/pull/3086) [`e962f01`](https://github.com/PostHog/posthog-js/commit/e962f01c80476b9325f0bbb4ca591820cfb9f338) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: support remote config for error tracking, session replay capture performance and capture logs
  (2026-02-17)

## 1.22.0

### Minor Changes

- [#3045](https://github.com/PostHog/posthog-js/pull/3045) [`0acf16f`](https://github.com/PostHog/posthog-js/commit/0acf16fcbf8c32d5f28b86b6fa200271ad0b647e) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: Add `getFeatureFlagResult` to PostHogCore
  (2026-02-10)

## 1.21.0

### Minor Changes

- [#2820](https://github.com/PostHog/posthog-js/pull/2820) [`d578824`](https://github.com/PostHog/posthog-js/commit/d578824395ceba3b854970c2a7723e97466d9e9d) Thanks [@ordehi](https://github.com/ordehi)! - Add survey response validation for message length (min and max length). Fixes whitespace-only bypass for required questions. Existing surveys work unchanged but now properly reject blank responses.
  (2026-02-09)

## 1.20.2

### Patch Changes

- [#3028](https://github.com/PostHog/posthog-js/pull/3028) [`e055f9a`](https://github.com/PostHog/posthog-js/commit/e055f9a344d7c11309c56444383f79df335a5c51) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: Queue pending feature flags reload instead of dropping requests when a reload is already in flight
  (2026-02-09)

## 1.20.1

### Patch Changes

- [#3039](https://github.com/PostHog/posthog-js/pull/3039) [`8f75dae`](https://github.com/PostHog/posthog-js/commit/8f75dae39ae2938624ca49e778915a92f2491556) Thanks [@hpouillot](https://github.com/hpouillot)! - fix(err): fix console error capturing
  (2026-02-06)

## 1.20.0

### Minor Changes

- [#3023](https://github.com/PostHog/posthog-js/pull/3023) [`bb62809`](https://github.com/PostHog/posthog-js/commit/bb62809917845685ae7e2e6d5adad6be5528356e) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: only capture $set events if the user properties have changed
  (2026-02-04)

## 1.19.0

### Minor Changes

- [#3009](https://github.com/PostHog/posthog-js/pull/3009) [`c99e5fe`](https://github.com/PostHog/posthog-js/commit/c99e5feb043870357c8f722eb52542327c3f472b) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: add setPersonProperties method
  (2026-02-03)

## 1.18.0

### Minor Changes

- [#2996](https://github.com/PostHog/posthog-js/pull/2996) [`7768010`](https://github.com/PostHog/posthog-js/commit/77680105f1e8baf5ed1934d423494793d11ff01a) Thanks [@matheus-vb](https://github.com/matheus-vb)! - Filter out flags marked as failed before merging with cached values, preventing transient backend errors from overwriting previously evaluated flag states
  (2026-02-03)

## 1.17.0

### Minor Changes

- [#2966](https://github.com/PostHog/posthog-js/pull/2966) [`727536c`](https://github.com/PostHog/posthog-js/commit/727536cf5f1ab5a8d21fa9d4e2e6b13efc851fca) Thanks [@adboio](https://github.com/adboio)! - support "always" survey schedule
  (2026-01-29)

## 1.16.0

### Minor Changes

- [#2967](https://github.com/PostHog/posthog-js/pull/2967) [`cbe84c1`](https://github.com/PostHog/posthog-js/commit/cbe84c1ea8b6dd398569ed401139e9698e08fd64) Thanks [@adboio](https://github.com/adboio)! - support auto-submit on selection for survey rating questions
  (2026-01-29)

## 1.15.0

### Minor Changes

- [#2984](https://github.com/PostHog/posthog-js/pull/2984) [`8c0c495`](https://github.com/PostHog/posthog-js/commit/8c0c495caaf4cd7f950cbc77fdfc1df499772008) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - include possible pnpm bin path
  (2026-01-28)

## 1.14.1

### Patch Changes

- [#2971](https://github.com/PostHog/posthog-js/pull/2971) [`f51560c`](https://github.com/PostHog/posthog-js/commit/f51560caf78386cef5278f7cf0e9f253b2ec0e50) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: groups and groupidentify is a no-op if person profiles is set to never
  (2026-01-27)

## 1.14.0

### Minor Changes

- [#2917](https://github.com/PostHog/posthog-js/pull/2917) [`933c763`](https://github.com/PostHog/posthog-js/commit/933c7639ae30390ca562a0891d59649711b53522) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: add support for person_profiles react native, core and web-lite
  (2026-01-23)

## 1.13.0

### Minor Changes

- [#2882](https://github.com/PostHog/posthog-js/pull/2882) [`8a5a3d5`](https://github.com/PostHog/posthog-js/commit/8a5a3d5693facda62b90b66dead338f7dca19705) Thanks [@adboio](https://github.com/adboio)! - add support for question prefill in popover surveys, add useThumbSurvey hook
  (2026-01-20)

## 1.12.0

### Minor Changes

- [#2897](https://github.com/PostHog/posthog-js/pull/2897) [`b7fa003`](https://github.com/PostHog/posthog-js/commit/b7fa003ef6ef74bdf4666be0748d89a5a6169054) Thanks [@matheus-vb](https://github.com/matheus-vb)! - Add $feature_flag_error to $feature_flag_called events to track flag evaluation failures
  (2026-01-20)

- [#2931](https://github.com/PostHog/posthog-js/pull/2931) [`f0cbc0d`](https://github.com/PostHog/posthog-js/commit/f0cbc0d8e4e5efc27d9595676e886d6d3d3892f4) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: before_send support for web lite and react native
  (2026-01-20)

## 1.11.0

### Minor Changes

- [#2900](https://github.com/PostHog/posthog-js/pull/2900) [`23770e9`](https://github.com/PostHog/posthog-js/commit/23770e9e2eed1aca5c2bc7a34a6d64dc115b0d11) Thanks [@dmarticus](https://github.com/dmarticus)! - Renamed `evaluationEnvironments` to `evaluationContexts` for clearer semantics. The term "contexts" better reflects that this feature is for specifying evaluation contexts (e.g., "web", "mobile", "checkout") rather than deployment environments (e.g., "staging", "production").

  ### Deprecated
  - `posthog.init` option `evaluationEnvironments` is now deprecated in favor of `evaluationContexts`. The old property will continue to work and will log a deprecation warning. It will be removed in a future major version.

  ### Migration Guide

  ````javascript
  // Before
  posthog.init('<ph_project_api_key>', {
      evaluationEnvironments: ['production', 'web', 'checkout'],
  })

  // After
  posthog.init('<ph_project_api_key>', {
      evaluationContexts: ['production', 'web', 'checkout'],
  })
  ``` (2026-01-19)
  ````

## 1.10.0

### Minor Changes

- [#2881](https://github.com/PostHog/posthog-js/pull/2881) [`d37e570`](https://github.com/PostHog/posthog-js/commit/d37e5709863e869825df57d0854588140c4294b2) Thanks [@adboio](https://github.com/adboio)! - add support for thumbs up/down survey rating scale
  (2026-01-16)

## 1.9.1

### Patch Changes

- [#2593](https://github.com/PostHog/posthog-js/pull/2593) [`fba9fb2`](https://github.com/PostHog/posthog-js/commit/fba9fb2ea4be2ea396730741b4718b4a2c80d026) Thanks [@daibhin](https://github.com/daibhin)! - track LLMA trace_id on exceptions and exception_id on traces
  (2026-01-08)

- [#2856](https://github.com/PostHog/posthog-js/pull/2856) [`c1ed63b`](https://github.com/PostHog/posthog-js/commit/c1ed63b0f03380a5e4bb2463491b3f767f64a514) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: expose default stack parser creator
  (2026-01-08)

## 1.9.0

### Minor Changes

- [#2787](https://github.com/PostHog/posthog-js/pull/2787) [`b676b4d`](https://github.com/PostHog/posthog-js/commit/b676b4d7342c8c3b64960aa55630b2810366014e) Thanks [@lucasheriques](https://github.com/lucasheriques)! - feat: allow customizing text colors on web and react native
  (2025-12-22)

## 1.8.1

### Patch Changes

- [#2769](https://github.com/PostHog/posthog-js/pull/2769) [`6b0aabf`](https://github.com/PostHog/posthog-js/commit/6b0aabff893e44d1710b7d122a68bf023f4e0bd5) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: move the user-agent-utils from the browser to the core package
  (2025-12-17)

## 1.8.0

### Minor Changes

- [#2774](https://github.com/PostHog/posthog-js/pull/2774) [`2603a8d`](https://github.com/PostHog/posthog-js/commit/2603a8d6e1021cd8f84e8b61be77ce268435ebde) Thanks [@adboio](https://github.com/adboio)! - fix survey text color on react native
  (2025-12-16)

## 1.7.1

### Patch Changes

- [#2690](https://github.com/PostHog/posthog-js/pull/2690) [`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4) Thanks [@robbie-c](https://github.com/robbie-c)! - Related to https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182

  We didn't include any of the vulnerable deps in any of our packages, however we did have them as dev / test / example project dependencies.

  There was no way that any of these vulnerable packages were included in any of our published packages.

  We've now patched out those dependencies.

  Out of an abundance of caution, let's create a new release of all of our packages. (2025-12-04)

## 1.7.0

### Minor Changes

- [#2603](https://github.com/PostHog/posthog-js/pull/2603) [`e1617d9`](https://github.com/PostHog/posthog-js/commit/e1617d91255b23dc39b1dcb15b05ae64c735d9d0) Thanks [@dmarticus](https://github.com/dmarticus)! - add $feature_flag_evaluated_at properties to $feature_flag_called events
  (2025-12-03)

## 1.6.0

### Minor Changes

- [#2619](https://github.com/PostHog/posthog-js/pull/2619) [`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86) Thanks [@hpouillot](https://github.com/hpouillot)! - package deprecation
  (2025-11-24)

## 1.5.6

### Patch Changes

- [#2618](https://github.com/PostHog/posthog-js/pull/2618) [`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe) Thanks [@marandaneto](https://github.com/marandaneto)! - last version was compromised
  (2025-11-24)

## 1.5.5

### Patch Changes

- [#2589](https://github.com/PostHog/posthog-js/pull/2589) [`83f5d07`](https://github.com/PostHog/posthog-js/commit/83f5d07e4ae8c2ae5c6926858b6095ebbfaf319f) Thanks [@hpouillot](https://github.com/hpouillot)! - export logger creation
  (2025-11-20)

## 1.5.4

### Patch Changes

- [#2587](https://github.com/PostHog/posthog-js/pull/2587) [`c242702`](https://github.com/PostHog/posthog-js/commit/c2427029d75cba71b78e9822f18f5e73f7442288) Thanks [@hpouillot](https://github.com/hpouillot)! - export log level type
  (2025-11-20)

## 1.5.3

### Patch Changes

- [#2575](https://github.com/PostHog/posthog-js/pull/2575) [`8acd88f`](https://github.com/PostHog/posthog-js/commit/8acd88f1b71d2c7e1222c43dd121abce78ef2bab) Thanks [@hpouillot](https://github.com/hpouillot)! - fix frame platform property for $exception events
  (2025-11-19)

## 1.5.2

### Patch Changes

- [#2552](https://github.com/PostHog/posthog-js/pull/2552) [`87f9604`](https://github.com/PostHog/posthog-js/commit/87f96047739e67b847fe22137b97fc57f405b8d9) Thanks [@hpouillot](https://github.com/hpouillot)! - expose binary path resolution

## 1.5.1

### Patch Changes

- [#2540](https://github.com/PostHog/posthog-js/pull/2540) [`d8d98c9`](https://github.com/PostHog/posthog-js/commit/d8d98c95f24b612110dbf52d228c0c3bd248cd58) Thanks [@hpouillot](https://github.com/hpouillot)! - escape cli args and path in shell mode

## 1.5.0

### Minor Changes

- [#2520](https://github.com/PostHog/posthog-js/pull/2520) [`068d55e`](https://github.com/PostHog/posthog-js/commit/068d55ed4193e82729cd34b42d9e433f85b6e606) Thanks [@lricoy](https://github.com/lricoy)! - Add bot pageview collection behind preview flag. Enables tracking bot traffic as `$bot_pageview` events when the `__preview_capture_bot_pageviews` flag is enabled.

## 1.4.0

### Minor Changes

- [#2502](https://github.com/PostHog/posthog-js/pull/2502) [`751b440`](https://github.com/PostHog/posthog-js/commit/751b44040c4c0c55a19df2ad0e5f215943620e51) Thanks [@pauldambra](https://github.com/pauldambra)! - fix: bucketed rate limiter can calculate tokens without a timer

## 1.3.1

### Patch Changes

- [#2478](https://github.com/PostHog/posthog-js/pull/2478) [`e0a6fe0`](https://github.com/PostHog/posthog-js/commit/e0a6fe013b5a1e92a6e7685f35f715199b716b34) Thanks [@hpouillot](https://github.com/hpouillot)! - remove some export from main core

## 1.3.0

### Minor Changes

- [#2417](https://github.com/PostHog/posthog-js/pull/2417) [`daf919b`](https://github.com/PostHog/posthog-js/commit/daf919be225527ee4ad026d806dec195b75e44aa) Thanks [@dmarticus](https://github.com/dmarticus)! - feat: Add evaluation environments support for feature flags

  This PR adds base support for evaluation environments in the core library, allowing SDKs that extend the core to specify which environment tags their SDK instance should use when evaluating feature flags.

  The core library now handles sending the `evaluation_environments` parameter to the feature flags API when configured.

### Patch Changes

- [#2431](https://github.com/PostHog/posthog-js/pull/2431) [`7d45a7a`](https://github.com/PostHog/posthog-js/commit/7d45a7a52c44ba768913d66a4c4363d107042682) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: remove deprecated attribute $exception_personURL from exception events

## 1.2.4

### Patch Changes

- [#2419](https://github.com/PostHog/posthog-js/pull/2419) [`10da2ee`](https://github.com/PostHog/posthog-js/commit/10da2ee0b8862ad0e32b68e452fae1bc77620bbf) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - move binary calling logic to core package

## 1.2.3

### Patch Changes

- [#2414](https://github.com/PostHog/posthog-js/pull/2414) [`e19a384`](https://github.com/PostHog/posthog-js/commit/e19a384468d722c12f4ef21feb684da31f9dcd3b) Thanks [@hpouillot](https://github.com/hpouillot)! - create a common logger for node and react-native

## 1.2.2

### Patch Changes

- [#2370](https://github.com/PostHog/posthog-js/pull/2370) [`5820942`](https://github.com/PostHog/posthog-js/commit/582094255fa87009b02a4e193c3e63ef4621d9d0) Thanks [@hpouillot](https://github.com/hpouillot)! - remove testing export

## 1.2.1

### Patch Changes

- [#2356](https://github.com/PostHog/posthog-js/pull/2356) [`caecb94`](https://github.com/PostHog/posthog-js/commit/caecb94493f6b85003ecbd6750a81e27139b1fa5) Thanks [@hpouillot](https://github.com/hpouillot)! - update error properties builder

## 1.2.0

### Minor Changes

- [#2348](https://github.com/PostHog/posthog-js/pull/2348) [`ac48d8f`](https://github.com/PostHog/posthog-js/commit/ac48d8fda3a4543f300ced705bce314a206cce6f) Thanks [@hpouillot](https://github.com/hpouillot)! - chore: align js syntax with package support

## 1.1.0

### Minor Changes

- [#2330](https://github.com/PostHog/posthog-js/pull/2330) [`da07e41`](https://github.com/PostHog/posthog-js/commit/da07e41ac2307803c302557a12b459491657a75f) Thanks [@hpouillot](https://github.com/hpouillot)! - add error tracking processing

## 1.0.2

### Patch Changes

- [#2243](https://github.com/PostHog/posthog-js/pull/2243) [`1981815`](https://github.com/PostHog/posthog-js/commit/19818159b7074098150bc79cfa2962761a14cb46) Thanks [@hpouillot](https://github.com/hpouillot)! - add promise queue

## 1.0.1

### Patch Changes

- [#2219](https://github.com/PostHog/posthog-js/pull/2219) [`44d10c4`](https://github.com/PostHog/posthog-js/commit/44d10c46c5378fa046320b7c50bd046eb1e75994) Thanks [@daibhin](https://github.com/daibhin)! - provide utils methods
