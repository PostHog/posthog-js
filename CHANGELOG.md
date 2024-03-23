## 1.116.5 - 2024-03-23

- fix: posthog init should reject invalid config in TypeScript (#1097)

## 1.116.4 - 2024-03-22

- fix: custom event on sampling decision (#1094)
- feat: signal we have wrapped fetch (#1083)

## 1.116.3 - 2024-03-20

- fix: Return this if already loaded (#1092)

## 1.116.2 - 2024-03-18

- feat: add property so we can check if a client is using a proxy (#1084)

## 1.116.1 - 2024-03-18

- chore: Remove v2 rrweb checks (#1080)

## 1.116.0 - 2024-03-15

- fix: allow payload scrubbing override (#1085)

## 1.115.2 - 2024-03-15

- fix: canvas recording patches (#1082)
- chore: remove cypress log noise (#1086)

## 1.115.1 - 2024-03-15

- chore: remove v1 rrweb loading (#1078)

## 1.115.0 - 2024-03-14

- feat: track recording URL without pageview capture (#1076)
- fix: return typing of global functions (#1081)

## 1.114.2 - 2024-03-12

- fix: patch rrweb zero width canvas bug (#1075)

## 1.114.1 - 2024-03-12

- fix: Disabled compression and application json (#1074)

## 1.114.0 - 2024-03-12

- feat: report browser visibility state in replay (#1071)
- fix: typo in deny list (#1073)
- fix(posthog-js): manually bump patch (#1072)

## 1.113.4 - 2024-03-12

- fix(posthog-js): manually bump patch (#1072)
- fix: no empty requests (#1063)

## 1.113.2 - 2024-03-11

- fix: Send beacon request encoding (#1068)

## 1.113.1 - 2024-03-11

- fix: clarify redaction message (#1069)

## 1.113.0 - 2024-03-11

- feat: scrub payloads with forbidden words (#1059)
- chore: remove unused path (#1066)

## 1.112.1 - 2024-03-11

- Fix compression (#1062)

## 1.112.0 - 2024-03-08

- feat: Refactor request logic (#1055)
- feat: Add more ad ids (#1057)

## 1.111.3 - 2024-03-07

- chore: Rework SDK initialisation (#1023)

## 1.111.2 - 2024-03-06

- feat: Ensure ingestion domains follow the same logic. (#1049)

## 1.111.1 - 2024-03-06

- chore: Removed jsc callbacks (#1052)
- fix: posthog path to ignore (#1054)
- chore: add some privacy examples to the copy autocapture demo (#1053)

## 1.111.0 - 2024-03-05

- feat: copy and cut autocapture (#1047)
- fix: timezones are fun (#1050)

## 1.110.0 - 2024-02-28

- feat: allow linked flag variants to control recording (#1040)
- feat: reecord when timestamp is overriden by caller (#1033)
- chore: deprecate property_blacklist in favor of property_denylist (#1044)

## 1.109.0 - 2024-02-27

- feat: improve user agent detection (#1038)

## 1.108.4 - 2024-02-26

- Fix (#1042)

## 1.108.3 - 2024-02-23

- feat: Rollout new ingestion endpoints (#1032)

## 1.108.2 - 2024-02-22

- fix: Path for site apps (#1037)

## 1.108.1 - 2024-02-22

- fix(surveys): fix emoji scale (#1036)

## 1.108.0 - 2024-02-20

- fix(surveys): Render feedback preview (#1030)

## 1.107.0 - 2024-02-20

- feat: Allow changing persistence (#1025)

## 1.106.3 - 2024-02-19

- fix(surveys): survey popover improvements (#1029)

## 1.106.2 - 2024-02-19

- fix: protect against parent is not element (#1027)

## 1.106.1 - 2024-02-19

- fix: body capture handling (#1026)
- ci: Use GITHUB_OUTPUT envvar instead of set-output command (#958)

## 1.106.0 - 2024-02-15

- feat(surveys): preact surveys components (#964)

## 1.105.9 - 2024-02-14

- fix: empty token should be invalid (#1022)

## 1.105.8 - 2024-02-13

- feat: Simplify to just -api and -assets (#1018)
- fix: for want of a v the war was lost (#1017)

## 1.105.7 - 2024-02-11

- fix: allow custom events when idle (#1013)
- chore: no need to account for performance raw (#1012)
- chore: add test case for ahrefs bot (#1011)
- chore: really really write changelog to release (#1008)

## 1.105.6 - 2024-02-08

- feat: save posthog config at start of session recording (#1005)
- chore: test stopping and starting (#1009)

## 1.105.5 - 2024-02-08

- feat: account for persistence for canvas recording (#1006)
- chore: improve template to account for backwards compatibility (#1007)

## 1.105.4 - 2024-02-07

- feat: Add dynamic routing of ingestion endpoints (#986)
- Update CHANGELOG.md (#1004)

## 1.105.3 - 2024-02-07

identical to 1.105.1 - bug in CI scripts

## 1.105.2 - 2024-02-07

identical to 1.105.1 - bug in CI scripts

## 1.105.1 - 2024-02-07

- fix: autocapture allowlist should consider the tree (#1000)
- chore: move posthog test instance helper (#999)
- chore: nit pick log message (#997)
- chore: copy most recent changelog entry when creating a release (#995)

## 1.105.0 - 2024-02-06

- fix: Add warning and conversion for number distinct_id (#993)
- fix: Remove `baseUrl` from TypeScript compiler options (#996)

## 1.104.4 - 2024-02-02

- fix: very defensive body redaction (#988)
- fix: less eager timeout (#989)

## 1.104.3 - 2024-02-01

- feat: Fetch without window (#985)

## 1.104.2 - 2024-01-31

- fix: no throwing when reading the body (#984)

## 1.104.1 - 2024-01-31

- chore: make rate limiter error less scary (#983)

## 1.104.0 - 2024-01-31

- feat: Fetch support (#898)
- chore: Swap to main (#979)

## 1.103.2 - 2024-01-31

- fix: safer body processing (#980)

## 1.103.1 - 2024-01-28

- feat: safer rrweb events and regular full snapshots (#973)
- chore: update rollup (#974)
- chore: re-enable bundle checker now main and branches both use pnpm (#972)

## 1.103.0 - 2024-01-26

- feat: pnpm patch rrweb (#971)
- chore: convert to pnpm (#970)

## 1.102.1 - 2024-01-25

- chore: add debug logging for session id/recording (#969)

## 1.102.0 - 2024-01-24

- feat: send custom event when network status changes (#965)
- fix: integration test opting out (#959)

## 1.101.0 - 2024-01-22

- feat: canvas recording support (#946)
- refactor(surveys): Use Preact instead of vanilla JS (#963)

## 1.100.0 - 2024-01-15

- Enable scroll stats by default (#962)

## 1.99.0 - 2024-01-15

- feat: Support custom scroll selector (#961)

## 1.98.2 - 2024-01-11

- fix: Don't allow us.posthog.com to be used (#957)

## 1.98.1 - 2024-01-11

- fix: set the session id as soon as it changes (#956)
- fix: simplify test setup (#955)

## 1.98.0 - 2024-01-10

- feat: capture session options in a custom event (#954)

## 1.97.1 - 2024-01-09

- fix(surveys): fix feedback widget bugs (#953)

## 1.97.0 - 2024-01-09

- fix: add a comment explaining browser type prop (#952)
- feat: add opt_out_useragent_filter and $browser_type (#949)
- chore(surveys): add basic survey e2e tests (#948)
- Tidying and removing of old value (#941)

## 1.96.1 - 2023-12-15

- Add gas_source to campaign params (#934)
- feat: simplify payload config compared to rrweb proposal (#939)
- feat: remove given from another test file (#940)

## 1.96.0 - 2023-12-14

- make link survey link optional (#938)
- fix: import nuxt composables from #imports (#879)

## 1.95.1 - 2023-12-13

- Remove debug code from survey-utils (#937)

## 1.95.0 - 2023-12-12

- feat(surveys): custom and tab widget (#933)

## 1.94.4 - 2023-12-12

- Add a few more blocked uas (#936)

## 1.94.3 - 2023-12-12

- fix: class string separator (#935)

## 1.94.2 - 2023-12-11

- fix: cache subdomain discovery (#928)
- chore: corrects the changelog (#931)

## 1.94.1 - 2023-12-09

- fix: incorrect localhost handling (#930) 

## 1.94.0 - 2023-12-08

- feat: Swap to localstorage+cookie as default (#927)
- fix: sanitize class string more (#925) 
- chore: redirect users to the supportModal when implementation errors occur (#921)
- chore: Add comment to remind about updating the plugin-server (#924)
- add wbraid and gbraid to campaignParams (#923)

## 1.93.6 - 2023-12-05

- fix: Sanitize given api_host urls to not have a trailing slash (#920)

## 1.93.5 - 2023-12-05

- fix: handle newlines in classnames (#919)

## 1.93.4 - 2023-12-05

- feat: Show warning if identifying with "distinct_id" (#918)

## 1.93.3 - 2023-11-28

- fix: safer custom event on return from idle (#913)
- Add deprecation notice for disable_cookie (#912)

## 1.93.2 - 2023-11-23

- fix(flags): Make sure we don't override flags when decide is disabled (#911)

## 1.93.1 - 2023-11-23

- feat: send idle markers in session (#909)

## 1.93.0 - 2023-11-22

- feat(surveys): Add open-ended choices for multiple and single choice surveys (#910)

## 1.92.1 - 2023-11-21

- feat: payload capture - move timing into copied plugin (#902)

## 1.92.0 - 2023-11-20

- feat: Create elements chain string as we store it (#823)
- Move blocked UAs to own file (#905)
- chore: deflake a test (#904)
- chore: convert more tests to TS (#903)
- latest cypress action version (#900)

## 1.91.1 - 2023-11-15

- fix(surveys): button text field fix (#899)

## 1.91.0 - 2023-11-15

- fix: Window or document access across the code (#894)

## 1.90.2 - 2023-11-15

- chore: uniquify differently (#897)
- correct CHANGELOG.md (#896)

## 1.90.1 - 2023-11-15

- fix: seek subdomain correctly (#888)
- fix: merge server permissions for payload capture (#892)

## 1.90.0 - 2023-11-15

- fix(surveys): prioritize question button text field and thank you countdown is not automatic (#893)

## 1.89.2 - 2023-11-14

- fix: a little session buffering logic (#890)
- fix: make header comparison case insensitive (#891)
- fix: extend header denylist (#889)

## 1.89.1 - 2023-11-13

- fix(surveys): fix emoji rating scale bug (#887)
- feat: capture network payloads (internal alpha) (#886)
- fix: meaningful recordings integration tests (#885)
- fix(surveys): Send responded property with every type of survey (#883)
- Bump playground next yarn version (#874)
- chore: convert 2 more test files to remove given and switch to TS (#882)
- fix(surveys): whitelabel, input radio grouping, and auto text color bugs (#881)
- fix: session id should start null (#878)
- chore(deps): bump @babel/traverse from 7.11.0 to 7.23.2 (#835)
- chore(deps): bump @babel/traverse from 7.12.12 to 7.23.2 in /react (#836)
- chore(deps): bump next from 13.1.6 to 13.5.0 in /playground/nextjs (#855)

## 1.89.0 - 2023-11-13

- feat: capture network payloads (internal alpha) (#886)
- fix: meaningful recordings integration tests (#885)

## 1.88.4 - 2023-11-09

- fix(surveys): Send responded property with every type of survey (#883)
- Bump playground next yarn version (#874)
- chore: convert 2 more test files to remove given and switch to TS (#882)

## 1.88.3 - 2023-11-08

- fix(surveys): whitelabel, input radio grouping, and auto text color bugs (#881)

## 1.88.2 - 2023-11-08

- fix: session id should start null (#878)
- chore(deps): bump @babel/traverse from 7.11.0 to 7.23.2 (#835)
- chore(deps): bump @babel/traverse from 7.12.12 to 7.23.2 in /react (#836)

## 1.88.1 - 2023-11-02

- chore(deps): bump next from 13.1.6 to 13.5.0 in /playground/nextjs (#855)
- Tweak session prop names (#873)

## 1.88.0 - 2023-11-02

- feat(web-analytics): Add client-side session params (#869)

## 1.87.6 - 2023-10-31

- fix: add tests for browser and browser version detection (#870)

## 1.87.5 - 2023-10-30

- fix: include raw user agent in event properties (#868)

## 1.87.4 - 2023-10-30

- fix: logging pointless error when offline (#866)

## 1.87.3 - 2023-10-30

- feat: retry count in url (#864)

## 1.87.2 - 2023-10-27

- fix(surveys): Publish types in module (#863)

## 1.87.1 - 2023-10-26

- fix(surveys): clearer user property names (#861)

## 1.87.0 - 2023-10-26

- feat(surveys): Make selector targeting work, add user props (#858)

## 1.86.0 - 2023-10-26

- feat: allow backend to specify a custom analytics endpoint (#831)

## 1.85.4 - 2023-10-26

- fix: checkout every X minutes (#860)
- feat: lazily load exception autocapture (#856)

## 1.85.3 - 2023-10-25

- feat: Toolbar loading from state faster (#849)

## 1.85.2 - 2023-10-24

- fix(surveys): cancel listener should be on all questions (#854)
- Fix changelog.md (#853)
- fix: eslint does not fail build (#852)

## 1.85.1 - 2023-10-24

- fix: Disable the string reduction code until we can battle test it more. (#851)

## 1.85.0 - 2023-10-24

- feat: allow sampling based on decide response (#839)

## 1.84.4 - 2023-10-24

- log when browser offline (#850)
- chore: type checking in one place makes bundle smaller (#843)

## 1.84.3 - 2023-10-23

- fix: full snapshot every 10 minutes (#847)
- fix: really fix subdomain check to satisfy codeql (#845)

## 1.84.2 - 2023-10-23

- fix: heroku subdomain check (#842)

## 1.84.1 - 2023-10-19

- fix(surveys): fix multiple choice input unique ID bug (#841)

## 1.84.0 - 2023-10-18

- Fix bot user agent detection (#840)

## 1.83.3 - 2023-10-17

- fix(surveys): add listener to 0th element (#837)

## 1.83.2 - 2023-10-17

- chore: Make ratings start at 0 (#834)

## 1.83.1 - 2023-10-11

- feat: Move all logs everything over to logger (#830)
- Update DOMAIN_MATCH_REGEX (#787)

## 1.83.0 - 2023-10-10

- feat(surveys): Optional survey questions (#826)

## 1.82.3 - 2023-10-06

- fix: Typescript compilation of survey types (#827)

## 1.82.2 - 2023-10-05

- fix(surveys): open text value bug (#825)

## 1.82.1 - 2023-10-04

- fix(surveys): multiple choice survey submit button bug (#822)

## 1.82.0 - 2023-10-04

- feat: allow regex patterns and wildcards in survey url (#821)

## 1.81.4 - 2023-10-04

- fix(capture): Always update stored person props from $set (#820)

## 1.81.3 - 2023-10-02

- fix(surveys): Handle filtering on undefined (#810)
- feat(surveys): popup changes and multiple questions support (#819)

## 1.81.2 - 2023-09-28

- Fix config access (#816)
- fix: Remove complex get_config (#812)
- fix: Mask page URLs in session recordings (#811)

## 1.81.1 - 2023-09-26

- fix(types): Relative import to fix typescript compilation (#809)

## 1.81.0 - 2023-09-25

- feat(surveys): Make surveys site app native to posthog-js (#801)

## 1.80.0 - 2023-09-25

- Add root $el_text (#806)

## 1.79.1 - 2023-09-20

- fix: Increase timeout to 60 seconds (#803)
- chore: add tests on impact of empty autocapture config (#802)

## 1.79.0 - 2023-09-15

- feat: add an attribute denylist for autocapture (#800)

## 1.78.6 - 2023-09-15

- fix: toolbar cache busting (#798)

## 1.78.5 - 2023-09-14

- fix(flags): Enqueue follow up requests without dropping (#797)

## 1.78.4 - 2023-09-13



## 1.78.3 - 2023-09-13

- feat: different rate limiting handling (#765)

## 1.78.2 - 2023-09-12

- fix: Update rrweb (#793)

## 1.78.1 - 2023-09-07

- fix(flags): Re-enable reload only when request finishes (#791)

## 1.78.0 - 2023-09-07

- fix: Handle uninitialised helpers better (#767)

## 1.77.3 - 2023-09-05

- feat: test a better list of bots and allow users to configure the bot… (#788)

## 1.77.2 - 2023-08-25

- fix(autocapture): element properties tracked up to 1k bytes (#783)

## 1.77.1 - 2023-08-22

- feat: Add pathname to prev page events (#776)
- fix: Mitigate testcafe flakiness (#779)
- feat: Filter out events from GPTBot (#772)

## 1.77.0 - 2023-08-18

- feat: Add previous page properties to page events (#773)
- style: Tighten eslint rules (#775)
- chore: add media examples to playground (#771)

## 1.76.0 - 2023-08-10

- Fixed up tests to cover all cases (#770)

## 1.75.4 - 2023-08-09

- feat: remove old UUID code (#755)

## 1.75.3 - 2023-08-02

- chore: remove unused capture metrics (#766)

## 1.75.2 - 2023-07-26



## 1.75.1 - 2023-07-26

- fix: obey server side opt out for autocapture (#762)

## 1.75.0 - 2023-07-25

- feat: react to rate limiting responses (#757)

## 1.74.0 - 2023-07-25

- fix: Recording throttling for SVG-like things (#758)
- chore(deps): bump semver from 5.7.1 to 5.7.2 in /react (#732)
- chore(deps): bump semver from 6.3.0 to 6.3.1 in /playground/nextjs (#733)
- chore(deps): bump word-wrap from 1.2.3 to 1.2.4 in /react (#746)
- chore(deps): bump word-wrap from 1.2.3 to 1.2.4 (#747)
- chore(deps): bump word-wrap from 1.2.3 to 1.2.4 in /playground/nextjs (#750)

## 1.73.1 - 2023-07-21

- fix: protect against bundling bugs (#754)

## 1.73.0 - 2023-07-20

- feat: use uuidv7 everywhere (#742)

## 1.72.3 - 2023-07-19

- fix: defensive about unload logging (#751)

## 1.72.2 - 2023-07-19

- fix(flags): Don't return undefined for flags when decide is not hit but flags exist (#748)

## 1.72.1 - 2023-07-18

- fix(flags): Make sure flags are reloaded only once on identify calls (#744)

## 1.72.0 - 2023-07-18

- feat(flags): Allow disabling flags on first load (#740)
- chore: remove some slow tests that have served their purpose (#739)

## 1.71.0 - 2023-07-13

- chore: Removed people.set and mapped it to identify (#584)

## 1.70.2 - 2023-07-11

- feat: allow moving to UUID v7 by config in posthog-js (#731)

## 1.70.1 - 2023-07-10

- fix: UUIDs should not take literally forever to generate (#727)

## 1.70.0 - 2023-07-07

- feat: callback when session id changes (#725)

## 1.69.0 - 2023-07-05

- feat: capture page title with pageview (#721)

## 1.68.5 - 2023-06-28

- fix: invalid module d ts because computers are horrible (#715)
- fix(cd): use package manager field (#704)

## 1.68.4 - 2023-06-22

- feat(components): Give option to not track events on feature component (#708)

## 1.68.3 - 2023-06-22

- fix: PosthogProvider doesn't need to have the client be optional (#705)

## 1.68.2 - 2023-06-20

- feat: Group rrweb events into one capture (#694)

## 1.68.1 - 2023-06-15



## 1.68.0 - 2023-06-14



## 1.67.2 - 2023-06-12

- feat: allow decide response to configure errors to drop by pattern (#692)
- chore: no compatability testing for test files (#690)

## 1.67.1 - 2023-06-09



## 1.67.0 - 2023-06-07

- feat: get surveys api (#677)

## 1.66.1 - 2023-06-07

- Update utils.ts (#686)

## 1.66.0 - 2023-06-06

- chore: manual version bump (#684)
- feat: send event UUIDs (#672)

## 1.66.0 - 2023-06-06

Manual addition of version 1.66.0 because CI failed to automatically bump the version

- feat: send event UUIDs (#672)

## 1.65.0 - 2023-06-06

- feat: backoff with jitter (#678)

## 1.64.0 - 2023-06-06

- feat: Add missing maskTextFn for recordings (#679)

## 1.63.6 - 2023-06-06



## 1.63.5 - 2023-06-06

- add browserlist and eslint checking compatability using it (#673)

## 1.63.4 - 2023-06-05

- feat: default endpoint for session recordings is /s/ (#674)

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
