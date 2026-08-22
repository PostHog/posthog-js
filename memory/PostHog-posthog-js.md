# PostHog Watcher memory

...<older entries truncated>

t detect background extension background context
- Conclusion: Already fixed in posthog-js 1.373.0 by PR #3559.
- Labels: feature/flags, web, team/client-libraries
- URL: https://github.com/PostHog/posthog-js/issues/3551
- Relevant files: `packages/browser/src/remote-config.ts`, `packages/browser/src/__tests__/remote-config.test.ts`, `packages/browser/CHANGELOG.md`
- Findings: `RemoteConfigLoader.refresh()` returns without calling `reloadFeatureFlags()` when flags are disabled, `document` is absent, or `document.visibilityState` is `hidden`.; `remote-config.test.ts` contains a regression test that mocks the browser-common `document` export as `undefined`, simulates a browser-extension background context, and verifies that `reloadFeatureFlags()` is not called.; The browser changelog records PR #3559, "Skip remote config background refreshes when no document is available," under release 1.373.0.
- Fix assessment: No new change is appropriate: the current implementation contains the minimal missing-document guard and a focused regression test for this exact browser-extension scenario.

## 2026-08-22T16:20:22.544Z
- Item: issue #3574 — The Oculus Browser is not properly being detected
- Conclusion: Already fixed and released via PR #3581.
- Labels: feature/product-analytics, web, team/client-libraries
- URL: https://github.com/PostHog/posthog-js/issues/3574
- Relevant files: `packages/core/src/utils/user-agent-utils.ts`, `packages/browser/src/__tests__/utils/user-agent-utils.test.ts`, `packages/core/CHANGELOG.md`
- Findings: `detectBrowser` now returns `Oculus Browser` when the UA contains `OculusBrowser`, before the Samsung Internet and Chrome branches that also match Oculus/Meta Quest UAs.; `versionRegexes` includes an `OculusBrowser/<major>.<minor>` matcher, so the detected browser version is also attributed to Oculus Browser.; Browser unit tests cover Quest 2 UAs containing `OculusBrowser`, `SamsungBrowser`, and `Chrome`, plus a Quest 3 UA without the Samsung marker; both expect `Oculus Browser` and the Oculus version.; `packages/core/CHANGELOG.md` records PR #3581 in @posthog/core 1.29.6 as: "Detect Oculus Browser (Meta Quest headsets) correctly instead of falling back to Chrome."
- Fix assessment: No additional implementation is appropriate: the minimal ordered UA-marker fix and regression tests are already present and documented as released.

## 2026-08-22T16:21:53.978Z
- Item: issue #3576 — Bug: iframe mount/unmount memory leak
- Conclusion: Already fixed and released in posthog-js@1.379.1.
- Labels: feature/replay, web, team/client-libraries
- URL: https://github.com/PostHog/posthog-js/issues/3576
- Relevant files: `packages/browser/CHANGELOG.md`, `packages/rrweb/rrweb/src/record/index.ts`, `packages/rrweb/rrweb/src/record/iframe-manager.ts`, `packages/rrweb/rrweb/src/record/observer.ts`, `packages/rrweb/rrweb/test/record/memory-leaks.test.ts`, `packages/rrweb/rrweb/test/record/cross-origin-iframes.test.ts`
- Findings: The browser changelog for version 1.379.1 documents #3570 as releasing iframe documents and observers when same-origin iframes are removed, with end-to-end heap-snapshot validation.; The current recorder's wrapped mutation emitter cleans removed iframes regardless of recordCrossOriginIframes, disconnects per-iframe observer cleanups, removes iframe-manager state, and handles removed subtrees.; IframeManager captures every contentDocument seen across iframe loads and removes their mirror nodes and mutation buffers during teardown, covering src swaps to about:blank before unmount.; Regression tests cover same-origin removal with recordCrossOriginIframes disabled, nested iframe removal, reparenting without teardown, removal before first load, and cleanup of documents from multiple iframe navigations.; This is rrweb observer-lifecycle work, but it does not alter lazy-load contracts, recording start conditions, session rotation/flush behavior, or network wrappers.
- Fix assessment: The exact reported lifecycle leak was addressed by merged PR #3570 and released in 1.379.1. A further change without a reproduction on a current version would be speculative in recorder teardown code.

## 2026-08-22T16:22:34.438Z
- Item: issue #3577 — Feature Request: Customize survey height
- Conclusion: Valid feature request for configurable survey option-list height; existing labels are appropriate.
- Labels: enhancement, feature/surveys, web
- URL: https://github.com/PostHog/posthog-js/issues/3577
- Relevant files: `packages/browser/src/extensions/surveys/survey.css`, `packages/browser/src/extensions/surveys/components/QuestionTypes.tsx`, `packages/browser/src/extensions/surveys/surveys-extension-utils.tsx`, `packages/core/src/types.ts`, `packages/browser/src/posthog-surveys-types.ts`, `packages/browser/src/__tests__/extensions/surveys-utils.test.ts`
- Findings: `packages/browser/src/extensions/surveys/survey.css` defines `.limit-height` with `max-height: 256px` and vertical scrolling.; `packages/browser/src/extensions/surveys/components/QuestionTypes.tsx` applies `multiple-choice-options limit-height` to the fieldset used for single- and multiple-choice questions; the fixed limit currently affects the options list, not the complete survey container.; Survey appearance is already translated into CSS custom properties by `addSurveyCSSVariablesToElement`, including `--ph-survey-max-width`; the default browser appearance sets `maxWidth` to `300px`.; `SurveyAppearance` is defined in `packages/core/src/types.ts` and is explicitly documented as needing synchronization with the frontend type. It has no field for overall survey height, maximum height, or maximum option-list height.; `packages/browser/src/posthog-surveys-types.ts` re-exports the shared survey appearance type, so a browser-only type addition would not be sufficient for a product/API-facing appearance setting.; Existing survey utility tests cover CSS-variable mapping patterns, providing a focused place to add regression coverage once the field name and intended scope are agreed.
- Fix assessment: The CSS change itself is small, but the requested behavior is ambiguous: the report asks for an overall survey max height while the current 256px constraint belongs only to multiple-choice option lists. Choosing a public appearance field, defining whether it accepts CSS lengths or viewport-relative values, and keeping the shared frontend/core schema in sync are product/API decisions. Implementing one interpretation without that decision would be speculative.

## 2026-08-22T16:23:15.160Z
- Item: issue #3578 — JS SDK: reset() should work across subdomains
- Conclusion: Already fixed and released in posthog-js 1.418.0.
- Labels: feature/product-analytics, web, team/client-libraries
- URL: https://github.com/PostHog/posthog-js/issues/3578
- Relevant files: `packages/browser/src/storage.ts`, `packages/browser/src/posthog-persistence.ts`, `packages/browser/src/posthog-core.ts`, `packages/browser/src/__tests__/posthog-persistence.test.ts`, `packages/browser/CHANGELOG.md`
- Findings: `createLocalPlusCookieStore._remove()` removes localStorage only through `window.localStorage.removeItem(name)`, which is necessarily limited to the active origin, while it removes the cookie at the requested cookie domain scope.; The former default localStorage+cookie merge lets localStorage override conflicting cookie values; stale sibling-subdomain storage could therefore restore a pre-reset identity.; `cookieWinsOnConflict` makes cookie values authoritative for conflicts and removes stale identity-bound and event-visible localStorage state when a shared cookie reflects a sibling reset.; Regression tests explicitly cover reopening after a sibling reset and assert that the new anonymous cookie identity wins and stale user, group, flag, alias, and custom persisted values are cleared.; `posthog-js` 1.418.0 changelog entry for PR #4496 states that `cookieWinsOnConflict` addresses stale per-origin localStorage against shared cross-subdomain identity/session state and enables it for `2026-08-29` defaults.
- Fix assessment: No new PR is appropriate: the minimal safe approach has already been implemented, regression-tested, and released. Attempting to delete sibling-origin localStorage would not be possible with browser storage APIs.

## 2026-08-22T16:23:59.119Z
- Item: issue #3582 — Feature Request: React Native surveys - respect customization settings
- Conclusion: Survey position support is already released; font-family customization remains an unscoped React Native surveys enhancement.
- Labels: enhancement, feature/surveys, feature/mobile, react-native
- URL: https://github.com/PostHog/posthog-js/issues/3582
- Relevant files: `packages/react-native/src/surveys/surveys-utils.ts`, `packages/react-native/src/surveys/components/SurveyModal.tsx`, `packages/react-native/test/resolveSurveyAlignment.spec.ts`, `packages/react-native/src/surveys/PostHogSurveyProvider.tsx`, `packages/core/src/types.ts`, `packages/react-native/CHANGELOG.md`
- Findings: `SurveyModal` passes `appearance.position` to `resolveSurveyAlignment`, which maps all nine `SurveyPosition` values to React Native vertical and horizontal alignment.; `resolveSurveyAlignment` has tests covering every supported position plus the default and invalid-position fallback.; The React Native changelog records PR #3498 as released in `posthog-react-native` 4.43.13, explicitly fixing `SurveyModal` to honor `appearance.position`.; `PostHogSurveyProvider` merges project survey appearance with `defaultSurveyAppearance` and the optional `defaultSurveyAppearance` provider prop.; The shared `SurveyAppearance` type has color, text, button, input, position, and related survey fields, but no `fontFamily` field.; The inspected React Native survey text and input components apply colors and sizing but do not apply a font-family appearance override.
- Fix assessment: Position needs no new change, while typography needs an explicit product/API decision. A speculative `fontFamily` addition could be incomplete across headings, body text, buttons, rating controls, and inputs, and may not match the app's regular/bold font setup.

## 2026-08-22T16:24:57.867Z
- Item: issue #3590 — Bug: Canvas content missing or disappears during session replay (Flutter web & raw canvas)
- Conclusion: Credible session-replay canvas state-restoration bug; not a safe small fix without a focused seek regression test.
- Labels: feature/replay, web
- URL: https://github.com/PostHog/posthog-js/issues/3590
- Relevant files: `packages/browser/src/extensions/replay/external/lazy-loaded-session-recorder.ts`, `packages/rrweb/rrweb/src/record/observers/canvas/canvas-manager.ts`, `packages/rrweb/rrweb/src/record/workers/image-bitmap-data-url-worker.ts`, `packages/rrweb/rrweb/src/replay/index.ts`, `packages/rrweb/rrweb/src/replay/canvas/2d.ts`, `packages/rrweb/rrweb-snapshot/src/rebuild.ts`, `packages/rrweb/rrdom/src/diff.ts`, `packages/rrweb/rrweb/test/replayer.test.ts`
- Findings: The browser recorder enables rrweb canvas capture with recordCanvas and numeric canvas FPS sampling when canvas recording is enabled.; For FPS sampling, CanvasManager periodically snapshots canvases with createImageBitmap and emits a CanvasMutation containing clearRect followed by drawImage of an encoded frame.; Initial 2D canvas contents can be serialized as rr_dataURL, while later state relies on CanvasMutation events; a missing or incorrectly ordered frame can therefore leave a canvas blank after rebuilding.; During virtual-DOM fast-forward, replay queues canvas mutations on RRCanvasElement and rrdom applies them during diff. Both rr_dataURL restoration and 2D drawImage argument deserialization are asynchronous.; Existing coverage includes a fast-forward test for a painted canvas inside an iframe and recorder-level canvas tests, but no focused real-browser test was found that asserts raw canvas pixels after backward and forward seeks.; Canvas replay/reconstruction is a silent-corruption and security-sensitive path: any change must retain replay sandbox protections and use a real-browser visual or pixel assertion.
- Fix assessment: The likely fault spans sampled-frame capture, asynchronous image loading, virtual-DOM seek reconstruction, and rrdom diffing. A speculative ordering change could silently corrupt replays or alter recording volume. A deterministic browser regression test is needed before selecting the narrowest fix.

## 2026-08-22T16:26:20.046Z
- Item: issue #3588 — Bug: Surveys cause errors when trying to access localStorage cross-origin
- Conclusion: Already fixed and released in posthog-js 1.386.7.
- Labels: feature/surveys, web, team/client-libraries
- URL: https://github.com/PostHog/posthog-js/issues/3588
- Relevant files: `packages/browser/src/posthog-surveys.ts`, `packages/browser/src/extensions/surveys.tsx`, `packages/browser/src/extensions/surveys/surveys-extension-utils.tsx`, `packages/browser/src/storage.ts`, `packages/browser/CHANGELOG.md`, `packages/browser/src/__tests__/extensions/surveys-utils.test.ts`
- Findings: The browser changelog records PR #3832 under posthog-js 1.386.7 and explicitly says it guarded the remaining unprotected survey localStorage accesses for cross-origin iframes.; Survey reset in posthog-surveys.ts wraps localStorage removal, enumeration, and key deletion in try/catch, so inaccessible storage no longer propagates an exception.; Survey display and markSurveyAsSeen paths wrap writes to lastSeenSurveyDate in try/catch.; Survey utility code uses localStore for read paths; localStore catches storage access errors and returns null.; The survey utility tests verify that wait-period checks do not throw when localStorage.getItem is unavailable.
- Fix assessment: No new PR is appropriate: the minimal targeted guards for the reported cross-origin localStorage failures have already been merged and released.

## 2026-08-22T16:27:15.457Z
- Item: issue #3593 — Feature Request: Expose experiment metadata in SDKs
- Conclusion: Valid experiments feature request, but it requires a deliberately designed backend metadata contract rather than an SDK-only getter.
- Labels: enhancement, team/experiments, feature/experiments, node
- URL: https://github.com/PostHog/posthog-js/issues/3593
- Relevant files: `packages/node/src/client.ts`, `packages/node/src/extensions/feature-flags/feature-flags.ts`, `packages/node/src/types.ts`, `packages/core/src/types.ts`, `packages/browser/src/posthog-featureflags.ts`, `packages/types/src/feature-flags.ts`
- Findings: There is no getExperiments-style API in the inspected Node or shared-core SDK sources.; The shared /flags response model exposes evaluated feature-flag details, including key, enabled state, selected variant, and metadata such as flag id, version, description, payload, and has_experiment; it does not model experiment name, experiment description, or a general experiment-to-variant catalog.; Browser posthog-js exposes getFeatureFlagDetails(key), which returns details only for an evaluated feature flag rather than a list of experiment definitions.; posthog-node local evaluation loads complete flag definitions from /flags/definitions using a secret/personal credential. Those definitions include filters, cohorts, rollout information, payloads, and experiment_set, so exposing that existing object through a public SDK method would violate the requested minimal, non-sensitive contract.; The Node SDK now supports a project secret key as an alternative to a personal API key for local evaluation, but that credential remains server-only and does not meet the request for a safely public/project-key-authenticated metadata API.
- Fix assessment: An SDK-only implementation would either lack the requested experiment data or risk exposing the full local-evaluation definitions. The necessary data shape, authorization model, disclosure policy, and cache semantics need backend and experiments-product decisions before a small SDK accessor can be implemented safely.

## 2026-08-22T16:29:00.224Z
- Item: issue #3859 — Respect session replay feature flag after /config endpoint call
- Conclusion: Already fixed in React Native 4.47.2 by PR #3828.
- Labels: react-native, feature/replay, feature/mobile, team/client-libraries
- URL: https://github.com/PostHog/posthog-js/issues/3859
- Relevant files: `packages/react-native/src/posthog-rn.ts`, `packages/react-native/test/session-replay-rearm.spec.ts`, `packages/react-native/CHANGELOG.md`, `.agents/skills/replay-incident-risk/INCIDENTS.md`
- Findings: During initialization, `PostHog` registers an `onFeatureFlags` handler when session replay is enabled; every flag load/reload invokes `_evaluateAndStartSessionReplay()`.; `_evaluateAndStartSessionReplayInternal()` evaluates the persisted session replay `linkedFlag` against current known feature flags. When the result is false and recording is active, it calls `_stopSessionRecording()`; when it later becomes true, it resumes recording.; `session-replay-rearm.spec.ts` explicitly verifies that recording pauses when a linked flag changes from true to false after `reloadFeatureFlagsAsync()`, then resumes when it becomes true again.; The React Native changelog for version 4.47.2 attributes this behavior to PR #3828: replay is re-evaluated whenever flags load/reload and a linked flag that turns off pauses recording instead of continuing until restart.; This is a recording-start-condition change. Any further buffering implementation would need focused tests for delayed fresh flag responses and deliberate fail-open/fail-closed behavior, since it can affect recording volume and privacy semantics.
- Fix assessment: The reported continuing-recording behavior is already addressed and regression-tested. Adding a speculative screenshot or disk-backed buffer would implement a stricter, separately defined guarantee and carries material recording-volume and data-handling risk.

## 2026-08-22T16:29:40.766Z
- Item: issue #3978 — Feature Request: Capture network info in event properties
- Conclusion: Valid browser SDK enhancement, but automatic default capture needs product and privacy decisions before implementation.
- Labels: enhancement, feature/product-analytics, web
- URL: https://github.com/PostHog/posthog-js/issues/3978
- Relevant files: `packages/browser-common/src/utils/event-utils.ts`, `packages/browser/src/posthog-core.ts`, `packages/browser/src/__tests__/utils/event-utils.test.ts`, `packages/types/src/posthog-config.ts`, `packages/browser/src/extensions/web-vitals/index.ts`
- Findings: `getEventProperties` in `packages/browser-common/src/utils/event-utils.ts` builds the default browser, device, URL, screen, timezone, language, library, insert-ID, and time properties; it has no Network Information API reads or network-quality properties.; `PostHog.calculateEventProperties` calls `getEventProperties` for normal events and merges the returned values into the final payload, so adding fields there would affect broad event capture.; The existing event-utility test suite covers default property collection and is the focused location for supported and unsupported Network Information API regression coverage.; `capture_performance` is documented as Session Replay network timing and Web Vitals configuration, and the Web Vitals extension captures performance metrics separately; neither currently provides connection-quality fields on every event.; Repository searches found no existing use of `navigator.connection`, `mozConnection`, `webkitConnection`, `effectiveType`, or `downlink`.
- Fix assessment: The code addition could be small, but introducing new automatically captured event properties creates a public data contract and affects every browser event. The requested fields have incomplete browser availability and may add fingerprinting/privacy and payload considerations. Selecting default-on versus opt-in behavior and stable property names before changing shared defaults avoids a speculative implementation.
