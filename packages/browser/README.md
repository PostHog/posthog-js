# PostHog JavaScript package

[![npm package](https://img.shields.io/npm/v/posthog-js?style=flat-square)](https://www.npmjs.com/package/posthog-js)
[![MIT License](https://img.shields.io/badge/License-MIT-red.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [JavaScript library docs](https://posthog.com/docs/libraries/js)

## Input value autocapture

Native `$autocapture` change events support field-level opt-in value capture for eligible inputs, textareas, and single-selects. Values are read from the control's `.value` when the browser emits `change`.

Value capture is a separate field-level opt-in: fields marked `data-ph-capture-value` include `$input_value`. Configure `autocapture.capture_value_css_selector_allowlist` with an array of CSS selectors or an `(element: Element) => boolean` predicate to choose other fields; `[]` disables value capture. Selectors match the field itself, not its ancestors.

Opted-in values are not automatically redacted. Use the synchronous `before_send` hook to edit or remove `$input_value`, or drop the event. Password, hidden, file, checkbox, and action inputs are excluded from value enrichment. Existing sensitive-field exclusions, no-capture markers, and `mask_all_text` remain protected.

## Surveys and capture

Built-in surveys stay hidden while event capture is disabled, including before consent when `opt_out_capturing_by_default` is enabled. This applies to automatic display, `displaySurvey()` (including `ignoreConditions`), and `renderSurvey()`. Delayed surveys recheck capture before appearing.

`canRenderSurvey()` and `canRenderSurveyAsync()` return a disabled reason in this state. Custom integrations can still discover surveys through `getActiveMatchingSurveys()`.

If capture stops while a survey is open, submitting keeps the answers in the form and shows an error. It does not mark the survey complete or clear its saved progress. The person can retry after capture is enabled again.
