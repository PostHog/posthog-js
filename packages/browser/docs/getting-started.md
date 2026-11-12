# Getting started

The JavaScript Web SDK runs in the browser.

To send your first event, add the HTML snippet to your site, or install `posthog-js` and call `posthog.init` once. Both take your project token and host from your [project settings](https://app.posthog.com/project/settings).

After `init`, PostHog captures pageviews and clicks by itself, so loading a page sends your first event to the Activity page in PostHog. Use `capture` for your own events.

For server-side JavaScript, use the Node.js SDK.

## Install with the HTML snippet

The snippet is the quickest way to add PostHog to a website. Paste it inside your site's `<head>` tags, just before `</head>`, so PostHog loads on every page. Replace the project token and host with your own.

The snippet loads the latest SDK from PostHog and calls `init`, so you can skip the next two steps.

<!-- prettier-ignore -->
```html
<script>
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init('<ph_project_api_key>', {
        api_host: 'https://us.i.posthog.com',
    })
</script>
```

## Install with a package manager

```bash
npm install posthog-js
```

## Initialize

```ts
import posthog from 'posthog-js'

posthog.init('<ph_project_api_key>', { api_host: 'https://us.i.posthog.com' })
```

## Capture an event

```ts
posthog.capture('signed_up', { plan: 'pro' })
```

## Identify a user

```ts
posthog.identify('user_123', { email: 'user@example.com' })
```

## Pin the snippet version

To pin the snippet, change `/static/array.js` to a major path such as `/static/1/array.js` or an exact path such as `/static/1.380.0/array.js`. Minor paths such as `/static/1.380/array.js` are not supported. Exact version paths never change, so your CDN or proxy can cache them for a long time. Keep cache times short for `/static/array.js` and `/static/1/array.js`.

## Verify the SDK with Subresource Integrity

From `posthog-js` 1.445.0, each release publishes a manifest of SHA-384 hashes at `/static/<SDK_VERSION>/integrity.json`. The npm package includes the same manifest at `dist/integrity.json`.

```bash
curl --fail --silent --show-error --location \
  "https://us-assets.i.posthog.com/static/<SDK_VERSION>/integrity.json" \
  --output posthog-integrity.json
```

The `files` object in the manifest maps each asset to its hash. Store the hashes in your source code. Don't fetch them at page load. Then replace the inline snippet with the static loader. Set `integrity` to `files["loader.js"]` and `data-core-integrity` to `files["array.js"]`.

```html
<script
    src="https://us-assets.i.posthog.com/static/<SDK_VERSION>/loader.js"
    integrity="sha384-<LOADER_SHA384_BASE64_DIGEST>"
    data-core-integrity="sha384-<ARRAY_SHA384_BASE64_DIGEST>"
    data-project-token="<ph_project_api_key>"
    crossorigin="anonymous"
></script>
```

The loader reads its options from these attributes:

- `data-api-host` sets your ingestion URL when you use a reverse proxy.
- `data-config` takes your other `init` options as JSON.
- `data-defer-init="true"` skips the automatic `init`, so you can call `posthog.init` yourself with function options.

The hashes cover only `loader.js` and `array.js`. They don't cover the recorder, surveys, toolbar, or `config.js` scripts. Use the manifest from the regional asset host you serve, because toolbar assets differ between regions.

## Persistence

PostHog stores the distinct ID, session ID, device ID, feature flags, super properties, and some config in the browser. The `persistence` option sets where:

- `localStorage+cookie` (default) stores the distinct ID and session ID in a cookie, and the rest in `localStorage`.
- `cookie` stores everything in a cookie.
- `localStorage` stores everything in `localStorage`.
- `sessionStorage` stores everything in `sessionStorage`.
- `memory` stores everything in page memory, so it lasts for one pageview.

Call `set_config` to change the mode after `init`, for example when a user accepts cookies.

```ts
posthog.set_config({ persistence: consent === 'yes' ? 'localStorage+cookie' : 'memory' })
```

Keep in mind:

- `cookieWinsOnConflict` requires `posthog-js` 1.418.0 or later. An open tab picks up cookie changes on its next capture or persistence write, not immediately.
- Cookies hold about 4KB. Large `cookie_persisted_properties` values or `cookie` persistence with many feature flags can cause `431 Request Header Fields Too Large` errors.
- In an iframe on another site, browsers treat PostHog cookies as third-party cookies and can block them. Pass an ID from the parent page and call `identify` inside the iframe.

## Init options and project settings

Some features have both an `init` option and a project setting. The winner depends on the feature.

| Feature               | Init option                      | Result                                                           |
| --------------------- | -------------------------------- | ---------------------------------------------------------------- |
| Exception autocapture | `capture_exceptions`             | The init option wins when set. Otherwise the project setting.    |
| Heatmaps              | `capture_heatmaps`               | The init option wins when set. Otherwise the project setting.    |
| Web vitals            | `capture_performance.web_vitals` | The init option wins when it's a boolean. Otherwise the setting. |
| Session replay        | `disable_session_recording`      | Both must allow it.                                              |
| Autocapture           | `autocapture`                    | Either can turn it off.                                          |
| Console logs          | `logs.captureConsoleLogs`        | Either can turn it on.                                           |

## Enriched flag analytics

To add view and interaction charts to a flag's Usage tab, capture `$feature_view` when a user sees the feature and `$feature_interaction` when they use it.

```ts
posthog.capture('$feature_view', { feature_flag: flag })

posthog.capture('$feature_interaction', {
    feature_flag: flag,
    $set: { [`$feature_interaction/${flag}`]: true },
})
```

## Sample by person or session

`posthog-js/customizations` also exports `sampleByDistinctId` and `sampleBySessionId` for `before_send`. Each one keeps all events or no events for a given ID.

```ts
import { sampleByDistinctId, sampleBySessionId } from 'posthog-js/customizations'

posthog.init('<ph_project_api_key>', {
    before_send: [sampleByDistinctId(0.4), sampleBySessionId(0.25)],
})
```

## Block Lighthouse traffic

PostHog doesn't block Lighthouse by default, so tools built on it, such as Ahrefs and Semrush, can inflate your numbers. To block it, add its user agents to `custom_blocked_useragents`.

```ts
posthog.init('<ph_project_api_key>', {
    custom_blocked_useragents: [
        'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    ],
})
```

## Use `posthog` in the browser console

Bundled apps often don't expose `window.posthog`. To reach the instance in Chrome or Firefox, set `debug: true`, find the `[PostHog.js] Starting in debug mode` log, expand the logged object, right-click `this`, and select **Store as global variable**. The instance is then available as `temp1` in Chrome or `temp0` in Firefox.
