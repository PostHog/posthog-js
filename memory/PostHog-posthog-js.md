# PostHog Watcher memory

...<older entries truncated>

mall change would be speculative because the obvious open/native and host-before-append paths are already implemented and tested. The missing reproduction leaves the root mode, framework implementation, timing, and whether failure is initial serialization or later mutation observation unknown.

## 2026-08-22T16:17:21.017Z
- Item: issue #2659 — Feature Request: Add option to flush with pending promises
- Conclusion: Already fixed and released for posthog-node.
- Labels: enhancement, feature, node, feature/error-tracking, feature/flags
- URL: https://github.com/PostHog/posthog-js/issues/2659
- Relevant files: `packages/node/src/client.ts`, `packages/core/src/posthog-core-stateless.ts`, `packages/node/src/__tests__/posthog-node.spec.ts`, `packages/core/src/__tests__/posthog.flush.spec.ts`, `packages/node/CHANGELOG.md`
- Findings: `PostHog` in `packages/node/src/client.ts` overrides `flush()` to call `flushWithPendingPromises()`.; `flushWithPendingPromises()` uses the core flush path with pending-work waiting enabled before `_flush()` reads and drains the event queue.; The core implementation snapshots the pending-promise queue before registering the flush promise and excludes the flush promises from its wait, avoiding a self-wait/deadlock.; Core tests cover waiting for pending work that enqueues an event, not waiting for work added after the flush begins, and continuing to flush queued events when pending work rejects.; Node tests explicitly verify that an immediate `flush()` after `captureException()` sends the asynchronously prepared `$exception` event.; `packages/node/CHANGELOG.md` records PR #4028 as released in `posthog-node` 5.39.2 on 2026-07-01.
- Fix assessment: No new implementation is appropriate: the requested behavior is already implemented, regression-tested, and released. The minimal resolved design makes Node flush() wait for pending SDK work rather than adding a separate public option.

## 2026-08-22T16:18:07.104Z
- Item: issue #2879 — Add `$feature_flags_error` to React-Native SDK
- Conclusion: Already implemented and released for React Native in posthog-react-native 4.22.0.
- Labels: feature/flags, team/feature-flags, react-native, feature/mobile
- URL: https://github.com/PostHog/posthog-js/issues/2879
- Relevant files: `packages/react-native/src/posthog-rn.ts`, `packages/react-native/test/posthog.spec.ts`, `packages/react-native/CHANGELOG.md`, `packages/core/src/posthog-core.ts`, `packages/core/src/types.ts`, `packages/core/src/featureFlagUtils.ts`
- Findings: `packages/react-native/src/posthog-rn.ts` declares `PostHog extends PostHogCore`, so React Native uses the shared feature-flag evaluation-event path.; `packages/core/src/posthog-core.ts` computes errors from stored `/flags` results and request failures, joins multiple values with commas, and conditionally adds `$feature_flag_error` when capturing `$feature_flag_called`.; `packages/core/src/types.ts` defines the expected error values: `errors_while_computing_flags`, `flag_missing`, `quota_limited`, `timeout`, `connection_error`, `unknown_error`, and `api_error_{status}`.; `packages/react-native/test/posthog.spec.ts` has a dedicated Feature flag error tracking suite covering missing flags, server-computation errors, quota limiting, HTTP 500 errors, comma-separated multiple errors, and absence of the property on successful evaluation.; `packages/react-native/CHANGELOG.md` records PR #2897, "Add $feature_flag_error to $feature_flag_called events to track flag evaluation failures", under released version 4.22.0.
- Fix assessment: No code change is appropriate because the requested behavior is already implemented, tested, and released. The minimal resolution is to direct affected users to upgrade if they are using a version older than 4.22.0.

## 2026-08-22T16:19:03.714Z
- Item: issue #3029 — Bug report: Session Replay causes app crash when used with @shopify/react-native-skia
- Conclusion: Likely an iOS native symbol/linkage compatibility bug between the legacy session-replay package and Skia, but it is not reproducible or actionable without a current-version minimal reproduction and crash evidence.
- Labels: feature/replay, react-native, feature/mobile, team/client-libraries
- URL: https://github.com/PostHog/posthog-js/issues/3029
- Relevant files: `packages/react-native/src/optional/OptionalPlugin.ts`, `packages/react-native/src/posthog-rn.ts`, `packages/react-native/package.json`, `packages/react-native/CHANGELOG.md`, `pnpm-lock.yaml`
- Findings: `packages/react-native/src/optional/OptionalPlugin.ts` resolves `@posthog/react-native-plugin` or the legacy `posthog-react-native-session-replay` module at native JavaScript module load time; JavaScript replay configuration cannot remove a package that was already linked into the iOS binary.; The current React Native package declares `posthog-react-native-session-replay >= 1.6.0` as its optional peer dependency, while the report used legacy version 1.2.3.; The React Native changelog for version 4.46.0 documents an opt-in replay >= 1.6.0 path that resolves `posthog-ios` through Swift Package Manager when configured with dynamic frameworks; this is relevant to a suspected static-library symbol collision but does not prove the reported libwebp diagnosis.; No vendored posthog-ios/libwebp source, native podspec, crash log, or minimal reproduction is present in this repository, so the claimed `WebP*`/`VP8*` collision cannot be verified here.; No JavaScript-only change is justified: namespacing native C symbols or changing iOS linkage belongs in the native replay/posthog-ios dependency and requires validation against a reproducible application.
- Fix assessment: The suspected fault is in native iOS dependency linkage or globally exported vendored libwebp symbols, not in the React Native JavaScript integration. The exact crash, symbol owner, and linkage configuration have not been supplied, and broad symbol remapping would be a high-impact native dependency change without a regression reproduction.

## 2026-08-22T16:19:37.549Z
- Item: issue #3551 — Bug Report: Remote config doesn't detect background extension background context
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
