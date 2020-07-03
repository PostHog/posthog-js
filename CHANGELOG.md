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
