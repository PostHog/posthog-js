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

`crossorigin="anonymous"` is recommended but optional on the loader tag. Without it, the loader still works, but uses the browser's default script request mode and has limited cross-origin error reporting. The loader cannot change the mode of its own request after download. The full SDK script it injects always uses `crossOrigin = 'anonymous'`, regardless of the outer tag.

Use `eu-assets.i.posthog.com` for EU projects. Every project loads the same static file: the loader reads `project_token` from its own URL, falling back to `data-project-token`. Putting the token in the URL path instead would require additional routing, as with Sentry's loader.

The small loader exposes queued public SDK methods, including `people.set` and `people.set_once`, and asynchronously loads an immutable SDK bundle without forwarding the query string. Its method list is generated from the SDK class during the build, so it stays in sync without bundling the SDK itself. Existing snippet and npm installations are unchanged; use only one installation method per page.

Include the tag before application scripts that call `posthog`. Do not add `async` or `defer` if those scripts need the queue immediately. Calls before the full SDK loads are queued; synchronous getters cannot return SDK values yet. The loader does not buffer browser interactions or errors that happen before the SDK installs its listeners.

| Attribute            | Purpose                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-project-token` | Project token fallback when the URL has no `project_token` value.                                                                               |
| `data-api-host`      | Ingestion host, including relative proxy paths such as `/ingest`. Inferred for the standard US/EU asset hosts; required for custom asset hosts. |
| `data-defaults`      | Defaults snapshot override. If neither this attribute nor `data-config.defaults` is set, the SDK uses `unset`.                                  |
| `data-config`        | JSON object with SDK options, applied before initialization. Explicit `data-api-host` and `data-defaults` attributes take precedence.           |
| `data-defer-init`    | Set to `true` to wait for an explicit `init()` call. Defaults to `false`.                                                                       |

For consent-gated automatic installation, set `data-config='{"opt_out_capturing_by_default":true}'` on the tag before it executes.

### Deferred initialization

Set `data-defer-init="true"` to download the SDK without automatically initializing it. The default is `false`. Pass the project token and all configuration to an explicit `posthog.init()` call instead. The automatic-init token and configuration attributes are not used in this mode.

```html
<script src="https://us-assets.i.posthog.com/static/loader.js" data-defer-init="true" crossorigin="anonymous"></script>
<script>
    posthog.init('phc_TOKEN', {
        api_host: 'https://us.i.posthog.com',
        defaults: '2026-08-30',
    })
    posthog.capture('example event')
</script>
```

Call `init()` before other SDK methods. If the SDK is still downloading, initialization and subsequent calls are queued. If it has already downloaded, `init()` uses the normal SDK API. Deferred initialization supports function-valued configuration, such as `before_send`, and named instances. It does not defer downloading the scripts and is separate from HTML's `defer` attribute.

The mutable `/static/loader.js` and `/static/<major>/loader.js` aliases embed their SDK build version and load `/static/<build-version>/array.js`. A cached loader therefore keeps using its matching SDK even when the aliases change. The loader does not fall back to the mutable `/static/array.js` alias.

To pin the SDK, use `/static/<version>/loader.js` for a release that includes the loader. An explicitly versioned loader URL keeps loading its versioned sibling `array.js`. Historical releases without a loader are not changed or backfilled. Reverse proxies and self-hosted deployments must serve the versioned SDK directories as well as the loader, along with the SDK's normal API/config/extension paths.

Fatal automatic-initialization configuration errors are reported even when debug mode is off. Invalid JSON configuration still prevents automatic initialization.

The loader forwards its CSP nonce to the SDK script. Your CSP must still allow the SDK, its extensions, and event ingestion. An existing legacy stub or live global instance takes precedence: the loader never replaces it or switches its project token.

### Nonblocking SDK loading

To keep application startup independent of the analytics host while preserving early SDK calls, serve the SDK's `dist/loader-bootstrap.js` from your application's own origin. Copy it from the installed `posthog-js` package during your build rather than maintaining a separate bootstrap or method list:

```sh
cp node_modules/posthog-js/dist/loader-bootstrap.js public/scripts/posthog-bootstrap.js
```

Load this local file before initialization and application scripts. Set `data-asset-host` to the asset origin or a reverse-proxy prefix, not a script URL. Use `https://eu-assets.i.posthog.com` for EU assets, or a relative prefix such as `/ingest` for a same-origin proxy.

```html
<script src="/scripts/posthog-bootstrap.js" data-asset-host="https://us-assets.i.posthog.com"></script>
<script>
    posthog.init('phc_TOKEN', {
        api_host: 'https://us.i.posthog.com',
        defaults: '2026-08-30',
        before_send: function (event) {
            return event.event === 'private event' ? null : event
        },
    })
    posthog.capture('early event')
</script>
<script async src="/app.js"></script>
```

The local bootstrap immediately exposes the same generated queued methods as the hosted loader and downloads the SDK directly and asynchronously from `<asset-host>/static/<version>/array.js`. There is no intermediate `loader.js` request or queue handoff. The injected SDK script uses anonymous CORS and inherits the local script's CSP nonce.

Your SDK version is the `posthog-js` version you copied the bootstrap from, not a mutable CDN alias. Update the installed package and recopy the bootstrap to change that version and keep its generated method list current. Reverse proxies must serve the matching versioned SDK assets.

Call `posthog.init()` with the project token and configuration before other SDK methods. Function-valued configuration, such as `before_send`, named instances, and early calls are queued while the SDK downloads. This installation does not automatically initialize from a URL token. Script URLs, query strings, and fragments in `data-asset-host` are rejected with a configuration error.

Do not add `async` or `defer` to the local bootstrap if subsequent scripts need the queue immediately. It must be available with your application assets; only the analytics-host download is independent of application startup. A stalled or failed SDK download leaves calls queued without marking the SDK ready. This does not buffer browser interactions or errors before SDK listeners start. Do not combine this installation with the legacy snippet or a separately initialized npm SDK.

## Input value autocapture

Native `$autocapture` change events support field-level opt-in value capture for eligible inputs, textareas, and single-selects. Values are read from the control's `.value` when the browser emits `change`.

Value capture is a separate field-level opt-in: fields marked `data-ph-capture-value` include `$input_value`. Configure `autocapture.capture_value_css_selector_allowlist` with an array of CSS selectors or an `(element: Element) => boolean` predicate to choose other fields; `[]` disables value capture. Selectors match the field itself, not its ancestors.

Opted-in values are not automatically redacted. Use the synchronous `before_send` hook to edit or remove `$input_value`, or drop the event. Password, hidden, file, checkbox, and action inputs are excluded from value enrichment. Existing sensitive-field exclusions, no-capture markers, and `mask_all_text` remain protected.

## Surveys and capture

Built-in surveys stay hidden while event capture is disabled, including before consent when `opt_out_capturing_by_default` is enabled. This applies to automatic display, `displaySurvey()` (including `ignoreConditions`), and `renderSurvey()`. Delayed surveys recheck capture before appearing.

`canRenderSurvey()` and `canRenderSurveyAsync()` return a disabled reason in this state. Custom integrations can still discover surveys through `getActiveMatchingSurveys()`.

If capture stops while a survey is open, submitting keeps the answers in the form and shows an error. It does not mark the survey complete or clear its saved progress. The person can retry after capture is enabled again.
