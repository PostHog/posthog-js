## 1.63.3 - 2023-06-02

- fix: Typescript import issue with rrweb (#670)

## 1.63.2 - 2023-06-01

- fix: only allow exception capture on remote enabled (#659)

## 1.63.1 - 2023-05-31

- fix: performance observer is not always available (#663)
- chore: correct pnpm version (#662)

## 1.63.0 - 2023-05-31

- feat: remove lz compression (#654)

## 1.62.0 - 2023-05-31

- feat: Exception Autocapture (#649)

## 1.61.0 - 2023-05-30

- feat(react): Flag autocapture component (#622)

## 1.60.0 - 2023-05-30

- feat: Added support for cross origin iframe recording (#655)

## 1.59.0 - 2023-05-30

- feat: remove broken capture using img support (#651)

## 1.58.0 - 2023-05-26

- Add get_session_id and get_session_replay_url functions  (#647)

## 1.57.4 - 2023-05-25

- fix: Session timeout overridden on reload (#645)

## 1.57.3 - 2023-05-23

- fix: properties with "length" value (#640)
- docs: Update README around releasing and development (#634)
- chore: add test for $identify events count optimization (#639)
- ci: consolidate library checks into one workflow (#638)
- ci: add prettier and eslint linting stage (#637)
- chore: add pre-commit to run lint staged. (#636)
- chore: add functional tests (#635)

## 1.57.2 - 2023-05-17



## 1.57.1 - 2023-05-17

- fix(decide): Make sure all stored properties are sent on first decide request (#633)
- fix(identify): actually send $set_once on identify calls (#629)

## 1.57.0 - 2023-05-15

- feat: Added OS version to the OS details (#624)
- fix: Don't delete existing flags on decide errors (#621)

## 1.56.0 - 2023-05-09

- feat: Allow custom masking of network events (#620)

## 1.55.2 - 2023-05-09

- feat: Added idle timer to recordings (#626)
- docs: Add Nuxt 3 demo  (#623)

## 1.55.1 - 2023-05-03

- fix: Script loading before DOM is ready (#618)
- Expose options to mask text in session recording (#595)

## 1.55.0 - 2023-04-28

- feat(beta-management): Add opt-in and out functions (#616)

## 1.54.0 - 2023-04-26

- release new version (#617)
- feat(flags): Allow adding person and group property overrides for flags (#613)

## 1.53.4 - 2023-04-18

- feat: Allow masking of input by referencing the element (#611)

## 1.53.3 - 2023-04-17

- fix: Usage of sessionStorage even if memory persistence (#609)

## 1.53.2 - 2023-04-14

- fix: Don't enable web perf by default for localhost (#608)

## 1.53.1 - 2023-04-13

- chore: bump version (#607)
- feat: Swap over to storing network events in recordings (#606)

## 1.53.0 - 2023-04-12

- feat: Custom campaign param support (#603)
- chore(deps): Bump http-cache-semantics from 4.1.0 to 4.1.1 (#528)
- fix: change user_id -> $user_id in docstring (#525)
- Remove flag param from useActiveFeatureFlags (#599)

## 1.52.0 - 2023-04-05

- fix: Track referrer/search params per browser session (#496)  
  _**Note:** This change improves the accuracy of properties `$referrer` and `$referring_domain` in a major way. Previously, the values of these properties often represented pure backlinks in non-SPAs (non-single-page applications). Now those values will represent the true referrer for the current browser-level session (effectively: for the tab). Due to this, referrer data after this update _may_ look different. It will be significantly more accurate though._
- ci: Point out and close stale issues/PRs (#602)
- docs(testcafe): update docs removing posthog server requirements (#594)

## 1.51.5 - 2023-03-23

- fix(segment): handle race condition on loading segment integration (#586)

## 1.51.4 - 2023-03-20

- fix: fewer moving parts more like safe text (#590)

## 1.51.3 - 2023-03-17

- try/catch the bit that fails so we don't just eject the element (#585)
- fix(persistence): set SameSite=None explicitly (#578)

## 1.51.2 - 2023-03-15

- fix: Catch fullsnapshot error (#583)

## 1.51.1 - 2023-03-14

- fix: debug nested span text, part 3 (#582)

## 1.51.0 - 2023-03-14

- added types for PostHog provider `options` (#581)
- ci(testcafe): run browser tests in parallel (#579)

## 1.50.9 - 2023-03-13

- fix: debug nested span text (part 2) (#577)
- feat: use autocapture setting from decide (#575)

## 1.50.8 - 2023-03-10

- reinstate getNestedSpanText, but with no recursion (#576)

## 1.50.7 - 2023-03-09

- fix: debug return empty string on getNestedSpanText (#573)

## 1.50.6 - 2023-03-09

- fix: Only call capture snapshot if recording (#572)

## 1.50.5 - 2023-03-09

- Update rrweb (#570)
- fix: Race condition error with loading rrweb (#569)
- fix: remove warning of duplicate nextjs import (#566)

## 1.50.4 - 2023-03-06

- chore: Revert canvas recording option (#567)
- tolerate undefined target (#565)

## 1.50.3 - 2023-03-02

- fix: spans inside buttons (#563)

## 1.50.2 - 2023-03-02

- fix(bots): add "hubspot" and "crawler" to blocked user agents (#564)

## 1.50.1 - 2023-03-01

- feat: allow record canvas (#562)
- chore: remove old nextjs utils folder (#559)

## 1.50.0 - 2023-02-28

- feat: react library (#540)

## 1.49.0 - 2023-02-28

- feat: augment autocapture using data attributes (#551)

## 1.48.2 - 2023-02-28

- fix: safari iteration error on web performance server timing (#558)

## 1.48.1 - 2023-02-28

- chore: expose errors (#557)
-  try the compressed-size-action GH action (#556)

## 1.48.0 - 2023-02-27

- fix: apply terser plugin to module.js and es.js (#555)

## 1.47.0 - 2023-02-27

- chore: no-op change to allow version bump (#554)
- feat(rrweb): implement rrweb2 dynamic loading on decide (#552)

## 1.46.2 - 2023-02-22

- no-op change to allow version bump (#549)
- more leniency for envs with 'window' undefined (#541)

## 1.46.1 - 2023-02-21

- chore: Remove Sentry types to reduce clashes (#546)
- fix: Removed Sentry types from compiled types (#545)

## 1.46.0 - 2023-02-21

- feat: Add optional loading of rrweb2 (#543)
- feat: Add rrweb2 support (experimental) (#536)
- chore: upgrade @sentry/types (#539)

## 1.45.1 - 2023-02-14

- fix: default persons to anonymous (#534)

## 1.45.0 - 2023-02-14



## 1.43.1 - 2023-02-07

- fix: correctly persist user state across page loads (#531)

## 1.43.0 - 2023-02-07

- feat: reset marks user anonymous (#524)

## 1.42.3 - 2023-01-31

- chore(feature-flag): only return truthy values for onFeatureFlag (#522)

## 1.42.2 - 2023-01-26



## 1.42.1 - 2023-01-26
- Revert status check

## 1.42.0 - 2023-01-26
- N/A


## 1.41.0 - 2023-01-24

- Use decide v3 and return defined JSON payloads with matching flags
- Optimistically save evaluated flags even if server has issues

## 1.40.2 - 2023-01-20

- Revert "chore: move types dependency from dependencies to devdependencies (#504)" (#509)

## 1.40.1 - 2023-01-19

- fix: Sentry URL for recording (#507)

## 1.40.0 - 2023-01-18

- feat: capture clicked elements on rageclicks (#506)

## 1.39.5 - 2023-01-13

- chore: move types dependency from dependencies to devdependencies (#504)

## 1.39.4 - 2023-01-12

- fix: use django cache for toolbar js (#503)

## 1.39.3 - 2023-01-11

- fix(toolbar): Load toolbar only in body for turbolink (#499)
- Install pnpm for usage in PR step (#502)

## 1.39.2 - 2023-01-06

- fix: page view ids didn't work with server side config (#501)
- chore(deps): Bump json5 from 2.1.3 to 2.2.3 in /react (#498)

## 1.39.1 - 2023-01-03

- feat: capture server timings (#497)

## 1.39.0 - 2022-12-23

- feat: Adds performance capture (#488)
- fix(options): Add capture_pageleave option (#491)
- fix(cd): use pnpm to install posthog-js version in main repo (#495)

## 1.38.1 - 2022-12-15

- fix: Reduce cookie modifications to stop infinite loops with CMP tools (#489)

## 1.38.0 - 2022-12-13

- feat: page view ids (#487)

## 1.37.0 - 2022-12-07

- feat: event_allowlist and url_allowlist for autocapture (#481)
- chore(deps): Bump qs from 6.5.2 to 6.5.3 (#484)
- chore(deps): Bump decode-uri-component from 0.2.0 to 0.2.2 (#485)
- chore(deps): Bump decode-uri-component from 0.2.0 to 0.2.2 in /react (#483)
- chore(deps): Bump minimatch from 3.0.4 to 3.1.2 (#469)
- feat(rageclicks): turn on rageclicks by default (#480)

## 1.36.1 - 2022-12-01

- update sentry types (#479)
- fix: support copying non-extensible objects (#478)
- feat(groups): allow resetting only user's groups (#476)

## 1.36.0 - 2022-11-22

- feat(sentry-integration): Add `ui_host` option for reverse-proxying (#475)
- chore(deps): Bump minimatch from 3.0.4 to 3.1.2 in /react (#468)

## 1.35.0 - 2022-11-15

- feat: Proper Segment plugin to enable Recordings and more (#471)

## 1.34.1 - 2022-11-14

- feat: allow disable compression in config (#467)

## 1.34.0 - 2022-10-25

- feat(toolbar): posthog.loadToolbar({ temporaryToken: 'key' }) (#464)
- chore(deps): Bump node-fetch from 2.6.1 to 2.6.7 (#361)
- chore(deps): bump glob-parent from 5.1.1 to 5.1.2 (#462)
- chore(deps): Bump browserslist from 4.16.1 to 4.21.4 (#463)
- chore(deps): Bump moment from 2.29.1 to 2.29.4 (#422)
- chore(deps): Bump tmpl from 1.0.4 to 1.0.5 (#329)
- chore(deps): Bump jsdom from 16.4.0 to 16.7.0 in /react (#415)
- chore(deps): Bump jsdom from 16.2.2 to 16.5.0 (#416)
- chore(deps): bump nanoid from 3.1.20 to 3.3.4 (#442)
- chore(deps): bump ansi-regex from 5.0.0 to 5.0.1 (#436)
- chore(deps): Bump async from 3.2.0 to 3.2.3 (#409)
- chore(deps): Bump minimist from 1.2.5 to 1.2.6 (#380)
- chore(deps): Bump minimist from 1.2.5 to 1.2.6 in /react (#379)
- chore(deps): Bump lodash from 4.17.19 to 4.17.21 (#353)
- Bump path-parse from 1.0.6 to 1.0.7 (#331)

## 1.33.0 - 2022-10-18

- feat(capture): Track `navigator.language` as `$language` (#460)

## 1.32.4 - 2022-10-11

- fix(apps): grab the correct global var (#459)

## 1.32.3 - 2022-10-11

- feat(apps): rename "inject" to "site apps" (#458)

## 1.32.2 - 2022-09-30

- feat(apps): load web apps from external scripts, no eval (#456)

## 1.32.1 - 2022-09-29

- feat(apps): add opt_in_web_app_injection (#454)

## 1.32.0 - 2022-09-29

- feat(apps): inject javascript from decide (#453)

## 1.31.1 - 2022-09-28

- feat(recordings): server side console log setting (#452)

## 1.31.0 - 2022-09-23

- feat: Improve SentryIntegration, include error message, type and tags at top level (#450)
- fix(recordings): unique window id on duplication (#446)

## 1.30.0 - 2022-09-12

- feat(feature-flags): Enable bootstrapping the library (#444)

## 1.29.3 - 2022-08-29

- fix(pageleave): Improve $pageleave reliability (#439)

## 1.29.2 - 2022-08-25

- fix(typing): rrweb types (#441)

## 1.29.1 - 2022-08-23

- fix(toolbar): Use apiURL from state if set (#438)

## 1.29.0 - 2022-08-16

- fix: Use rollup and fix define module issues (#434)

## 1.27.0 - 2022-08-01

- refactor: Dummy commit to trigger release (#431)
- chore(typescript): convert library to typescript (#425)

## 1.26.2 - 2022-07-28

- fix(session-id): reset session_id on reset() call (#430)

## 1.26.1 - 2022-07-28

- fix(storage): Fix cross subdomain cookies for localpluscookie (#429)
- fix: Testcafe using Posthog cloud (#428)

## 1.26.0 - 2022-07-19

- fix: dont set initial referrer (#426)

## 1.25.2 - 2022-07-12

- feat: Add msclkid param to campaign keywords (#424)
- chore(deps): Update @sentry/types for 7.2.0 (#412)

## 1.25.1 - 2022-06-29

- fix: Add facebook crawlers to blocked user agents (#417)

## 1.25.0 - 2022-06-28

- feat(feature-flags): Enable experience continuity (#404)
- chore: Update changelog for 1.24.0 (#411)

## 1.24.0 - 2022-06-01

- feat: Limit session recordings to 24 hours (#405)
    - a new recording is immediately started and no data is lost 

## 1.23.0 - 2022-06-01

- feat: Allow overriding device id generation (#401)
- Fix this.get_config undefined error (#397)

## 1.22.0 - 2022-05-31

- feat: add support to `fbclid` campaign parameter (#400)

## 1.21.1 - 2022-05-13

- chore(build): bumping to make release (#396)
- chore(dep): update rrweb to 1.1.3 (#395)

## 1.21.0 - 2022-05-11

- fix(recordings): mask all input fields for recordings (#388)

## 1.20.5 - 2022-05-10

- feat: add recording url to sentry integration (#371)
- fix(config): Case-insensitive persistence (#389)

## 1.20.4 - 2022-04-15

- fix(console-logs): handle undefined and null log (#385)

## 1.20.3 - 2022-04-11

- feat(recordings): add inline stylesheet option (#383)
- fix(config): Handle config undefined (#382)

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
