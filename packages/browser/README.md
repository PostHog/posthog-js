# PostHog JavaScript package

[![npm package](https://img.shields.io/npm/v/posthog-js?style=flat-square)](https://www.npmjs.com/package/posthog-js)
[![MIT License](https://img.shields.io/badge/License-MIT-red.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [JavaScript library docs](https://posthog.com/docs/libraries/js)

## Single script tag

```html
<script
    src="https://us-assets.i.posthog.com/static/loader.js?project_token=phc_YOUR_PROJECT_TOKEN"
    crossorigin="anonymous"
></script>
```

Use `eu-assets.i.posthog.com` for EU projects. Every project loads the same static file: the loader reads `project_token` from its own URL, falling back to `data-project-token`. Putting the token in the URL path instead would require additional routing, as with Sentry's loader.

The small loader exposes the same queued methods as the inline snippet and asynchronously loads `array.js` from the same directory, without forwarding the query string. Existing snippet and npm installations are unchanged; use only one installation method per page.

Include the tag before application scripts that call `posthog`. Do not add `async` or `defer` if those scripts need the queue immediately. Calls before the full SDK loads are queued; synchronous getters cannot return SDK values yet. The loader does not buffer browser interactions or errors that happen before the SDK installs its listeners.

| Attribute            | Purpose                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-project-token` | Project token fallback when the URL has no `project_token` value.                                                                               |
| `data-api-host`      | Ingestion host, including relative proxy paths such as `/ingest`. Inferred for the standard US/EU asset hosts; required for custom asset hosts. |
| `data-defaults`      | Defaults snapshot. Fixed at `2026-08-30` when omitted, independently of SDK upgrades.                                                           |
| `data-config`        | JSON object with SDK options, applied before initialization. Explicit `data-api-host` and `data-defaults` attributes take precedence.           |

For consent-gated installation, set `data-config='{"opt_out_capturing_by_default":true}'` on the tag before it executes. Use the existing snippet or npm integration when configuration needs JavaScript callbacks, such as `before_send`, or named instances.

To pin the SDK, use `/static/<version>/loader.js` for a release that includes the loader. It loads that release's sibling `array.js`; historical releases without a loader are not changed or backfilled. `/static/loader.js` follows stable releases. A reverse proxy must forward both the loader and SDK paths, along with the SDK's normal API/config/extension paths.

The loader forwards its CSP nonce to the SDK script. Your CSP must still allow the SDK, its extensions, and event ingestion. An existing legacy stub or live global instance takes precedence: the loader never replaces it or switches its project token.

## Surveys and capture

Built-in surveys stay hidden while event capture is disabled, including before consent when `opt_out_capturing_by_default` is enabled. This applies to automatic display, `displaySurvey()` (including `ignoreConditions`), and `renderSurvey()`. Delayed surveys recheck capture before appearing.

`canRenderSurvey()` and `canRenderSurveyAsync()` return a disabled reason in this state. Custom integrations can still discover surveys through `getActiveMatchingSurveys()`.

If capture stops while a survey is open, submitting keeps the answers in the form and shows an error. It does not mark the survey complete or clear its saved progress. The person can retry after capture is enabled again.
