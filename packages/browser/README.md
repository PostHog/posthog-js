# PostHog JavaScript package

[![npm package](https://img.shields.io/npm/v/posthog-js?style=flat-square)](https://www.npmjs.com/package/posthog-js)
[![MIT License](https://img.shields.io/badge/License-MIT-red.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [JavaScript library docs](https://posthog.com/docs/libraries/js)

## Surveys and capture

Built-in surveys stay hidden while event capture is disabled, including before consent when `opt_out_capturing_by_default` is enabled. This applies to automatic display, `displaySurvey()` (including `ignoreConditions`), and `renderSurvey()`. Delayed surveys recheck capture before appearing.

`canRenderSurvey()` and `canRenderSurveyAsync()` return a disabled reason in this state. Custom integrations can still discover surveys through `getActiveMatchingSurveys()`.

If capture stops while a survey is open, submitting keeps the answers in the form and shows an error. It does not mark the survey complete or clear its saved progress. The person can retry after capture is enabled again.

## Customizations bundle and `defer`

`customizations.full.js` publishes `window.posthogCustomizations` when the script runs. A page that loads it with `defer` runs it after the inline `posthog.init(...)`, so the global is missing while the `loaded` callback runs.

The snippet bootstrap installs a stub that queues the calls a customization makes on the instance it receives, such as `setAllPersonProfilePropertiesAsPersonPropertiesForFlags`. The bundle replays the queue when it lands, which reloads the flags with the person properties. The first flags request can still go out without them.

A customization that returns a value the caller uses at once - the sampling `before_send` builders, the Redux logger, and the Kea logger - needs the bundle to be there already, so do not defer the script when the page uses one of these. Bundler users can import them from the `posthog-js/customizations` subpath instead of the script.
