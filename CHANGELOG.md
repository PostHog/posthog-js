## 1.5.1 - 2020-10-22
- Autocapture bugfix: Ignore extra spaces in classnames #99
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
