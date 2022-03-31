## 1.20.2 - 2022-03-31

- fix(web-performance): clear resource timings after reading (#377)

## 1.20.1 - 2022-03-29

- feat(tracking): add ahrefsbot to list of ignored bots (#378)

## 1.20.0 - 2022-03-23

- feat: send library version outside of compressed body as a debug signal (#376)

## 1.19.2 - 2022-03-22

- Revert "feat: send library version outside of compressed body as a debug signal (#351)" (#375)

## 1.19.1 - 2022-03-22

- fix: truncate console logs (#372)

## 1.19.0 - 2022-03-22

- feat: send library version outside of compressed body as a debug signal (#351)
- ci: create new PRs in main repo with chore: (#370)

## 1.18.0 - 2022-03-16

- Add console log recording (#367)
- fix(properties): dont modify input properties (#369)

## 1.17.9 - 2022-03-04

- fix(web performance): calculate duration when it isn't present on navigation timing (#368)
- Upgrade jest to remove security vulnerability (#365)

## 1.17.8 - 2022-02-02

- Fix for enabling a disabled session recording (#364)

## 1.17.7 - 2022-02-01

- fix onFeatureFlag (#363)

## 1.17.6 - 2022-01-28

- Remove capture failed request (#362)

## 1.17.5 - 2022-01-27

- Only hit onFeatureFlags callback after decide (#360)

## 1.17.4 - 2022-01-27

- Fix featureflags not working when /decide is down (#359)

## 1.17.3 - 2022-01-20

- Add an allow list to skip truncating strings when capturing events (#355)

## 1.17.2 - 2022-01-20

- remove debug option (#357)

## 1.17.1 - 2022-01-13

- Reduce the size of the APM performance data payload (#354)

## 1.17.0 - 2022-01-10

- Send APM data so that we don't need a plugin (#352)
- Allow APM performance on all $pageview events (#350)
- Include browser performance values on $pageview (#347)
- add more advice to pull request template (#349)
- Update README.md (#348)

## 1.16.8 - 2021-12-21

- add resetSessionId function (#345)

## 1.16.7 - 2021-11-25

- Feature flags groups support & /decide refactor (#341)

## 1.16.6 - 2021-11-18

- Avoid needless double /decide calls (#340)

## 1.16.5 - 2021-11-18

- try sendbeacon (#337)

## 1.16.4 - 2021-11-16

- allow disabling toolbar tracking for self-hosted users (#335)

## 1.16.3 - 2021-11-12

- Bumping the build for a release (#334)
- Filter out _nghost attributes from autocapture (#332)

## 1.16.2 - 2021-11-07

- update rrweb (#328)

## 1.16.1 - 2021-11-02

- Add window_id and session_id to all events (#326)

## 1.16.0 - 2021-10-28

- Group analytics support (#325)

## 1.15.4 - 2021-10-27

- pass toolbar to posthog (#327)

## 1.15.3 - 2021-10-19

- Add localStorage+cookie as persistence type (#324)

## 1.15.2 - 2021-10-18

- drop data uri filter limit from 20mb to 5mb (#322)

## 1.15.1 - 2021-10-18

- Take a full recording snapshot when session ids update (a fix for missing recordings) (#318)

## 1.15.0 - 2021-10-18

- Revert "Add posthog.people.increment" (#320)

## 1.14.4 - 2021-10-14

- filter data urls out of large payloads (#317)

## 1.14.3 - 2021-10-12

- Expand allowed input types to 'button', 'checkbox', 'submit', 'reset' (#315)

## 1.14.2 - 2021-10-12

- dont mind me, just bumping versions (#316)
- fix: localStorage access denied error being thrown (#312)

## 1.14.1 - 2021-10-06

- Reduce code paths that could encode post data as the string undefined (#300)

## 1.14.0 - 2021-10-05

- Bump build and a readme change (#306)
- Add posthog.people.increment (#254)
- Send initial pageview immediately (#295)
- add a test for init-ing and reading the on xhr error handler (#308)

## 1.13.17 - 2021-10-04

- corrects exported type which got out of sync with core.js file (#307)

## 1.13.16 - 2021-10-04

- Allow injection from config of a function to call when xhr requests fail (#296)
- add instructions for developing with Yalc (#303)
- Revert "Speculative logging for PostHog/posthog#4816 (#293)" (#302)
- Filter out _ngcontent attributes in autocapture (#298)
- corrects a test where assertion and setup didn't match test name (#299)

## 1.13.15 - 2021-09-29

- Speculative logging for PostHog/posthog#4816 (#293)
- Bump tmpl from 1.0.4 to 1.0.5 in /react (#287)
- Bump ansi-regex from 5.0.0 to 5.0.1 in /react (#294)

## 1.13.14 - 2021-09-28

- Revert "Trigger onFeatureFlags on reset (#263)" (#292)

## 1.13.13 - 2021-09-17

- Trigger onFeatureFlags on reset (#263)
- Do not crash when calling capture() after skipping init(), fixes #281 (#282)

## 1.13.12 - 2021-09-15

- Change UTM tags from first touch to last touch (#286)

## 1.13.11 - 2021-09-14

- Do not load toobar only if autocapture enabled (#285)

## 1.13.9 - 2021-09-10

- Split feature flags into `$feature/*` properties (#278)

## 1.13.8 - 2021-09-09

- Restore feature flag client-side override method (#280)

## 1.13.7 - 2021-09-06

- Revert "Do not load toolbar when disabled (#264)" (#276)

## 1.13.6 - 2021-09-06

- add gclid to campaign params (#277)

## 1.13.5 - 2021-09-02

- fix groupKey (#274)

## 1.13.4 - 2021-09-02

- console.warn to error (#273)

## 1.13.3 - 2021-09-02

- add posthog.group (#270)

## 1.13.2 - 2021-09-02

- fix "undefined is not an object" error (#272)

## 1.13.1 - 2021-09-02

- Deprecate client-side feature flag overrides (#271)

## 1.13.0 - 2021-09-01

- Feature flags API v2 (#268)

## 1.12.7 - 2021-08-29

- Update `rrweb` to 1.0.3 (#269)

## 1.12.6 - 2021-08-20

- Update `@sentry/types` to 6.11 (#267)

## 1.12.5 - 2021-08-17

- Do not load toolbar when disabled (#264)
- Bump path-parse from 1.0.6 to 1.0.7 in /react (#266)

## 1.12.4 - 2021-08-16

- Fix deps containing types not being installed (#265)

## 1.12.3 - 2021-08-04

- Add `rrweb-snapshot` to dev deps (#262)
- Don't retry 500 responses (#260)

## 1.12.2 - 2021-08-02

- Update decide.js (#258)

## 1.12.1 - 2021-07-16

- Allow session recording reload (#253)

## 1.12.0 - 2021-07-15

- Remove deprecated methods and options (#255)

## 1.11.4 - 2021-06-24

- fix invalid cookie (#250)

## 1.11.3 - 2021-06-14

- Capture viewport height and width (#246)
- Add extra local development instructions (#235)
- Update README.md (#243)

## 1.11.2 - 2021-06-07

- Fix overridden request retry data (#241)

## 1.11.1 - 2021-06-04
- Fix: avoid directly accessing localStorage (#239) 

## 1.11.0 - 2021-06-02

- Retry Queue (#226)
- Bump hosted-git-info from 2.8.8 to 2.8.9 in /react (#229)
- Bump lodash from 4.17.20 to 4.17.21 in /react (#225)
- Bump ws from 7.4.2 to 7.4.6 in /react (#237)
- Remove duplicates in CHANGELOG (#236)

## 1.10.2 - 2021-05-25

- Reconcile Server and Client side configurations for session recording and autocapture (#233)

## 1.10.1 - 2021-05-25

- Fix sessionRecording bug (#234)
- Update outdated releasing instructions (#224)
- changelog for 1.10.0 (#223)
- 1.10.0 (#222)
- Refactor /decide enpoint & allow recording without autocapture (#212)
- Add missing `disable_session_recording` property in Config interface (#221)
- Update types, add missing reloadFeatureFlags (#219)
- Fix in-progress check for utils/deepCircularCopy (#216)

## 1.10.0 - 2021-05-07

- Refactor /decide endpoint & allow recording without autocapture (#212)
- Fix in-progress check for utils/deepCircularCopy (#216)
- Update types, add missing reloadFeatureFlags (#219)
- Add missing disable_session_recording property in Config interface (#221)

## 1.9.7 - 2021-04-09

- Config Additions: session_recording, mask_all_element_attributes, mask_all_text (#209)

## 1.9.6 - 2021-03-30

- Support rrweb mask all inputs (#207)
- fix: incorrect typing for isFeatureEnabled (#208)

## 1.9.3 - 2021-03-12

- Fix SentryIntegration optional param typing (#203)

## 1.9.2 - 2021-03-12

- Add SentryIntegration TS (#202)
- add SentryIntegration typing (#202)

## 1.9.1 - 2021-03-08

- Add posthog.debug() to types, remove bad docstring (#201)
- Fix ".identify" docstrings (#200)

## 1.9.0 - 2021-03-03

- Device Type (#198)

## 1.8.10 - 2021-03-02

- Add properties_string_max_length = 65535 (#197)
- Remove unused notification code (#191)
- Remove old upgrade code (never used) (#192)
- Support $set_once with identify (#190)

## 1.8.9 - 2021-03-02

- Add Yarn lock resiliency (#196)
- Update README.md (#194)
- Add debug function (#193)
- Fix auto changelog (#188)
- Fix auto new version (#187)

## 1.8.7 - 2021-02-11
- Fix internal metric unpacking error

## 1.8.6 - 2021-02-05
- When logging in as another user, don't link those two identities (#174)
- Testcafe E2E tests, IE11 fixes (#180)

## 1.8.5 - 2021-01-18

- Allow passing custom domain for sentry integration (#176)
- Update typing (#173)

## 1.8.3 - 2021-01-11

- Event names must be strings in `posthog.capture` (#171)

## 1.8.1 - 2021-01-08

- Increase compatibility with IE 11 (#169)

## 1.8.0 - 2020-12-14

- Using gzip-based compression over lzstring using the fflate library: [fflate](https://github.com/101arrowz/fflate). This reduces the amount of data transferred, and makes posthog servers respond faster (requires posthog 1.19.0). https://github.com/PostHog/posthog/issues/2560
- Support last touch $referrer and $referring_domain user properties https://github.com/PostHog/posthog-js/pull/139
- Publish a ES dist file https://github.com/PostHog/posthog-js/pull/157
- Publish a react integration for feature flags https://github.com/PostHog/posthog-js/pull/154

## 1.7.2 - 2020-11-28

- Fix issues with incorrect headers being set on decide

## 1.7.1 - 2020-11-27
- Force session recording to use lz64 compression (https://github.com/PostHog/posthog-js/pull/134)
- Bundle module.js in es5 (https://github.com/PostHog/posthog-js/pull/132)

## 1.7.0 - 2020-11-26
- Send session recording events to posthog in (short) batches, separate from rest of events to make sure we drop fewer events (#126)
- Send session recording events to a separate endpoint for newer versions of posthog (#118)
- Send correct LIB_VERSION to posthog with captures (#119)
- Handle capturing self-referential objects (#123)
- Make the library smaller by dropping unneeded code (#123, #128)
- Update request batching logic (#118, #126)
- Notify rrweb when $pageview events happen (#127)
- Fix 'this.people.delete_user is undefined' (issue #39, #113)
- Update rrweb block class to use `ph-no-capture` and `ph-ignore-input` (#112)
- Deprecate calling posthog.capture with a callback (#129)
- Attempted to re-add support for including posthog-js in server-side rendering. (#131)
- Bugfix: Don't truncate session recording data (#121)
- Bugfix: Kill `posthog.capture_links()` and `posthog.capture_forms()`. They were broken since initial release - you can use autocapture instead. (#128)

## 1.6.0 - 2020-11-05
- Allow updating user properties when calling `posthog.identify('identity, { some: 'value' })` (#105)
- Allow disabling $feature_flag_called event: `posthog.isFeatureEnabled('flag', { send_event: false }) (#100)
- Make cookieless analytics possible by passing `persistence: 'memory'` to posthog.init (#82)
- Avoid sending $pageleave events when `capture_pageview: false` passed to posthog.init (#109)
- Code cleanup, bug fixes, integration test suite and more tech debt work

## 1.5.2 - 2020-10-22
- Autocapture bugfix: Ignore extra spaces in classnames #99
- Improve typing of posthog-js (#103)

## 1.5.1 - 2020-10-22
- Improve typing of posthog.js #97 (thanks @stonesthatwhisper)
- Improve session recording, generate $session_id fields #91 #96
- Fix a bug with session recording events not being saved #95
- Improve test coverage #94

## 1.5.0 - 2020-09-08
- Add beta functionality to do session recording
- Add $feature_flag_called event
- Add beta Sentry integration

## 1.4.5 - 2020-09-08
- Fix clicks in shadowroot for Firefox and Safari

## 1.4.4 - 2020-08-26
- Fix clicks within shadowroot not being captured
- Fix type definition of loaded

## 1.4.3 - 2020-08-11
- Remove "?." to support older browsers

## 1.4.2 - 2020-08-11
- Capture actions even if toolbar is in used

## 1.4.1 - 2020-08-10
- Remove unused parameter for `.reloadFeatureFlags()`

## 1.4.0 - 2020-08-10
- Have `.onFeatureFlags(callback)` register multiple callbacks, which get called when feature flags are loaded or updated
- Update feature flags when `identify` is called.
- Add option `.reloadFeatureFlags()`. Call it to trigger a reload of feature flags. (See [#71](https://github.com/PostHog/posthog-js/pull/71))
- Add config option `sanitize_properties` that accepts a function which sanitizes parameters of events (See [#75](https://github.com/PostHog/posthog-js/issues/75))

## 1.3.8 - 2020-08-07
- Set `secure_cookie` config to `true` if the page is running over https

## 1.3.7 - 2020-07-28
- Store toolbar session in localStorage (instead of sessionStorage) so you don't need to authorize in every tab you have open

## 1.3.6 - 2020-07-27
- Fix a parameter in the type definition

## 1.3.5 - 2020-07-20
- Add flag to respect Do Not Track setting

## 1.3.4 - 2020-07-16
- Capture safe attributes (id, name and class) if the element is an input (#63)

## 1.3.3 - 2020-07-16
- Add payload compression support (with lz-string) (#48)

## 1.3.2 - 2020-07-16
- Fix request batching when loading the library from npm and running `.init()` after DOM load.

## 1.3.1 - 2020-07-13
- Support loading the toolbar with a `__posthog` has param (was: `state`) and `ph_authorize` action.

## 1.3.0 - 2020-07-03
- Add TypeScript defintions

## 1.2.4 - 2020-07-01
- Add support for feature flags (`posthog.isFeatureEnabled('keyword')`)

## 1.2.3 - 2020-07-01
- Send $host and $pathname with $pageview requests (was just with $autocapture)
- Track clicks on elements which have `cursor:pointer`
- Better test suite

## 1.2.2 - 2020-06-15
- Allow setting properties on anonymous users

## 1.2.1 - 2020-06-09
- Simplify passing of API token to editor

## 1.2.0 - 2020-06-08
- Support passing various/dynamic parameters to the toolbar

## 1.1.2 - 2020-06-04
- Fix another error when using a new posthog-js version with an old posthog version

## 1.1.1 - 2020-06-04
- Show a error if calling `posthog.identify` with `null` user (#34 by @rushabhnagda11)

## 1.1.0 - 2020-06-04
- Support loading new PostHog toolbar

## 1.0.6 - 2020-03-09
- Send beacon on $pageleave
- Clean up a bunch of code
- Don't reset device id on reset

## 1.0.4 - 2020-03-04
- Fix Heroku App Cookie Bug
- Batch Event Posts
- Support TurboLinks
- Send Timestamp with events

## 1.0.0 - 2020-02-20
First Release.
