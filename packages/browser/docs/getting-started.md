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

## Use other package managers

Pin the major version when you install, with the package manager you use.

```bash
npm install --save posthog-js@1
```

```bash
yarn add posthog-js@1
```

```bash
pnpm add posthog-js@1
```

```bash
bun add posthog-js@1
```

Then initialize PostHog with your project token and host. You can find both in [your project settings](https://us.posthog.com/settings/project).

```js
import posthog from 'posthog-js'

posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    defaults: '<ph_posthog_js_defaults>',
})
```

## Find your snippet

Your [project settings](https://app.posthog.com/settings/project#snippet) show the HTML snippet with your project token and host already filled in.

Once the snippet is on your site, PostHog captures `$pageview` and [other events](https://posthog.com/docs/data/autocapture) like button clicks. You can then enable other products, such as session replay, in [your project settings](https://app.posthog.com/settings).

## Set up frameworks

The framework docs have more installation details:

- [Next.js](https://posthog.com/docs/libraries/next-js)
- [React](https://posthog.com/docs/libraries/react)
- [Vue](https://posthog.com/docs/libraries/vue-js)
- [Angular](https://posthog.com/docs/libraries/angular)
- [Astro](https://posthog.com/docs/libraries/astro)
- [Remix](https://posthog.com/docs/libraries/remix)
- [Svelte](https://posthog.com/docs/libraries/svelte)

Other ways to install:

- **Google Tag Manager.** You can install and configure PostHog from Google Tag Manager with the PostHog tag template, without a custom HTML tag. See the [Google Tag Manager docs](https://posthog.com/docs/libraries/google-tag-manager).
- **AI code editors.** In editors like Lovable, Bolt.new, and Replit, give the editor this prompt: `npx -y @posthog/wizard@latest`.
- **VS Code.** The [PostHog VS Code extension](https://posthog.com/docs/vscode-extension) shows live analytics, flag status, and session replay links inline in your code.

## Support ES5 browsers

If you need ES5 support, for example to track Internet Explorer 11, replace `/static/array.js` in the snippet with `/static/array.full.es5.js`.

## Use a reverse proxy

Tracking blockers can intercept events sent straight to PostHog. A [reverse proxy](https://posthog.com/docs/advanced/proxy) makes that less likely, so we recommend one.

- **Managed reverse proxy.** PostHog's [managed reverse proxy](https://posthog.com/docs/advanced/proxy/managed-reverse-proxy) is free for all PostHog Cloud users. It routes through PostHog's infrastructure.
- **Your own proxy.** You can also create one with [Cloudflare](https://posthog.com/docs/advanced/proxy/cloudflare), [AWS CloudFront](https://posthog.com/docs/advanced/proxy/cloudfront), or [Vercel](https://posthog.com/docs/advanced/proxy/vercel).

## Track across your sites

Put PostHog on both your marketing website and your app. You can then follow a user from their first visit, through signup, to using your product.

- **One project.** If you have several customer-facing products, like a marketing website, a mobile app, and a web app, install PostHog on all of them and [group them in one project](https://posthog.com/docs/settings/projects). You can then track users across their whole journey and across platforms.
- **Subdomains.** PostHog sets a cross-subdomain cookie. If your website is `yourapp.com` and your app is on `app.yourapp.com`, PostHog follows users from one to the other.
- **Different domains.** See the [cross-domain tracking tutorial](https://posthog.com/tutorials/cross-domain-tracking).

## Allowlist PostHog IPs

For some features, like [heatmaps](https://posthog.com/docs/toolbar/heatmaps), your Web Application Firewall (WAF) can block PostHog's requests to your site. Add these IP addresses to your WAF allowlist or rules.

- **EU.** `3.75.65.221`, `18.197.246.42`, `3.120.223.253`, `3.40.9.80/28`
- **US.** `44.205.89.55`, `52.4.194.122`, `44.208.188.173`, `3.41.215.48/28`

These are public, stable IPs used by PostHog services.

PostHog captures heatmap screenshots with [Browserless](https://www.browserless.io), which has its own IP addresses. Browserless [publishes the current list](https://docs.browserless.io/baas/troubleshooting/whitelisting-ips).

An allowlist doesn't help when your app has a private address. For apps on an internal network, see [internal and intranet applications](https://posthog.com/docs/session-replay/troubleshooting#internal-and-intranet-applications).

## Keep the SDK current

PostHog releases the web SDK often.

- **HTML snippet.** The snippet loads the latest release for you. Avoid setups that cache an old SDK version. See [ways SDK versions fall behind](https://posthog.com/docs/health-checks/keeping-sdks-current#ways-sdk-versions-fall-behind).
- **npm package.** Update it often. Change the version constraint in `package.json` and reinstall, or run `update` instead of `install`.

```bash
npm update posthog-js
```

```bash
pnpm update posthog-js
```

```bash
yarn upgrade posthog-js
```

```bash
bun update posthog-js
```

## Add TypeScript types

If you install `posthog-js` from a package manager, the types are already included. You need the `@posthog/types` package only when you load PostHog with a `<script>` tag and want types for `window.posthog`.

<!-- prettier-ignore -->
```html
<!-- You load PostHog like this -->
<script>
    !function(t,e){...}(document,window.posthog||[]);
    posthog.init('your-api-key', { api_host: 'https://us.i.posthog.com' })
</script>
```

These packages already include their types:

| Package                | Description                               |
| ---------------------- | ----------------------------------------- |
| `posthog-js`           | Browser SDK                               |
| `posthog-js-lite`      | Lighter browser SDK (types are different) |
| `posthog-node`         | Node.js SDK                               |
| `posthog-react-native` | React Native SDK                          |
| `@posthog/react`       | React hooks and components                |

```typescript
// Types are already available when you install posthog-js
import posthog from 'posthog-js'

posthog.init('your-api-key')
posthog.capture('my_event') // ✅ Fully typed
```

For the script tag, install the types package:

```bash
npm install @posthog/types@1
# or
yarn add @posthog/types@1
# or
pnpm add @posthog/types@1
# or
bun add @posthog/types@1
```

Create a type declaration file to type `window.posthog`:

```typescript
// posthog.d.ts
import type { PostHog } from '@posthog/types'

declare global {
    interface Window {
        posthog?: PostHog
    }
}

export {}
```

You can then use `window.posthog` with full type safety:

```typescript
// Your code
window.posthog?.capture('button_clicked', { button_id: 'signup' })
window.posthog?.identify('user-123', { email: 'user@example.com' })

const flagValue = window.posthog?.getFeatureFlag('my-flag')
if (flagValue === 'variant-a') {
    // ...
}
```

You can also use the types to check your configuration objects:

```typescript
import type { PostHogConfig, Properties } from '@posthog/types'

// Type your configuration
const config: Partial<PostHogConfig> = {
    api_host: 'https://us.i.posthog.com',
    autocapture: true,
    capture_pageview: 'history_change',
}

// Type event properties
const eventProps: Properties = {
    button_id: 'signup',
    page: '/pricing',
}
```

The `@posthog/types` version matches the `posthog-js` version. PostHog always releases them together, so the type definitions stay in sync with the SDK.

## Bundle all extensions

By default, the JavaScript Web SDK loads only the core functionality. It lazy-loads extensions, such as surveys or the session replay recorder, when it needs them.

This can cause problems if:

- You have a Content Security Policy (CSP) that blocks inline scripts.
- You want to optimize your bundle at build time, so all dependencies are ready immediately.
- Your app runs somewhere that rejects or blocks remote code loading, like the Chrome Extension store or [Electron](https://posthog.com/tutorials/electron-analytics).

To solve this, pick one of these import options.

```js
// No external code loading possible (this disables all extensions such as Replay, Surveys, Exceptions etc.)
import posthog from 'posthog-js/dist/module.no-external'

// No external code loading possible but all external dependencies pre-bundled
import posthog from 'posthog-js/dist/module.full.no-external'

// All external dependencies pre-bundled and with the ability to load external scripts (primarily useful is you use JS snippets)
import posthog from 'posthog-js/dist/module.full'

// Finally you can also import specific extra dependencies
import 'posthog-js/dist/posthog-recorder'
import 'posthog-js/dist/surveys'
import 'posthog-js/dist/exception-autocapture'
import 'posthog-js/dist/tracing-headers'
import 'posthog-js/dist/web-vitals'
import posthog from 'posthog-js/dist/module.no-external'

// All other posthog commands are the same as usual
posthog.init('<ph_project_token>', { api_host: '<ph_client_api_host>', defaults: '<ph_posthog_js_defaults>' })
```

> **Note.** With any of the `no-external` options, the toolbar is unavailable. It only works as a runtime dependency loaded directly from `us.posthog.com`.

> **Note.** Always import `posthog-js` from the same module. If you don't, your build can include more than one bundle. `@posthog/react` works only with the default module import.

## Use the slim bundle

If you need only some PostHog features, the slim bundle reduces your bundle size. It gives you the core functionality, which is event capture, identify, and group analytics. You opt in to other features with extension bundles. The slim bundle is experimental, but it gives the largest reduction in bundle size.

```js
import posthog from 'posthog-js/dist/module.slim'
import { SessionReplayExtensions, AnalyticsExtensions } from 'posthog-js/dist/extension-bundles'

posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    defaults: '<ph_posthog_js_defaults>',
    __extensionClasses: {
        ...SessionReplayExtensions,
        ...AnalyticsExtensions,
    },
})
```

> **Note.** Always import `posthog-js` from the same module path (`posthog-js/dist/module.slim`) throughout your app. If you don't, your build can include more than one bundle.

These extension bundles are available:

| Bundle                    | What's included                                                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FeatureFlagsExtensions`  | [Feature Flags](https://posthog.com/docs/feature-flags)                                                                                                                                                                                |
| `SessionReplayExtensions` | [Session Replay](https://posthog.com/docs/session-replay)                                                                                                                                                                              |
| `AnalyticsExtensions`     | [Autocapture](https://posthog.com/docs/product-analytics/autocapture), pageview tracking, [heatmaps](https://posthog.com/docs/toolbar/heatmaps), dead click detection, [web vitals](https://posthog.com/docs/web-analytics/web-vitals) |
| `ErrorTrackingExtensions` | [Error Tracking](https://posthog.com/docs/error-tracking)                                                                                                                                                                              |
| `SurveysExtensions`       | [Surveys](https://posthog.com/docs/surveys)                                                                                                                                                                                            |
| `ExperimentsExtensions`   | [Experiments](https://posthog.com/docs/experiments)                                                                                                                                                                                    |
| `SiteAppsExtensions`      | [JS snippets](https://posthog.com/docs/js-snippets)                                                                                                                                                                                    |
| `TracingExtensions`       | Distributed tracing header injection                                                                                                                                                                                                   |
| `ToolbarExtensions`       | [Toolbar](https://posthog.com/docs/toolbar)                                                                                                                                                                                            |
| `LogsExtensions`          | [Log capture](https://posthog.com/docs/logs)                                                                                                                                                                                           |
| `ConversationsExtensions` | [Support](https://posthog.com/docs/support)                                                                                                                                                                                            |
| `WebMCPExtensions`        | [WebMCP tool call capture](https://posthog.com/docs/mcp-analytics/installation/webmcp)                                                                                                                                                 |
| `AllExtensions`           | Everything                                                                                                                                                                                                                             |

`WebMCPExtensions` captures tool calls for MCP Analytics. Add `ErrorTrackingExtensions` to also send failed calls to Error Tracking. `AllExtensions` is the same as the default `posthog-js` bundle.

Each extension bundle includes its own dependencies. You don't need to add them separately.

## Skip events in development

If you don't want to send test data while you develop, initialize PostHog only outside your local hosts.

```js
if (!window.location.host.includes('127.0.0.1') && !window.location.host.includes('localhost')) {
    posthog.init('<ph_project_token>', { api_host: '<ph_client_api_host>', defaults: '<ph_posthog_js_defaults>' })
}
```

To see what PostHog would send without sending it, return `null` from `before_send`.

```ts
posthog.init('<ph_project_token>', {
    before_send: (event: CaptureResult | null): CaptureResult | null => {
        if (event) {
            console.log('posthog event: ' + event.event, event)
        }
        return null
    },
})
```

## The defaults option

The `defaults` option is a date that selects a configuration snapshot. PostHog uses that snapshot as the defaults when it initializes. The examples use the latest snapshot. An option you set explicitly overrides the snapshot.

| `defaults` value | What it changes                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `'unset'`        | Legacy behaviors. This is the default.                                                                                                   |
| `'2025-05-24'`   | `capture_pageview` defaults to `'history_change'`                                                                                        |
| `'2025-11-30'`   | Also enables `session_recording.strictMinimumDuration` and `rageclick.content_ignorelist`                                                |
| `'2026-01-30'`   | Also sets `external_scripts_inject_target` to `'head'`                                                                                   |
| `'2026-05-30'`   | Also sets `persistence_save_debounce_ms: 250`, `split_storage: true`, `detect_google_search_app: true`, and expanded rage click defaults |
| `'2026-06-25'`   | Also sets `session_recording.streamNetworkBody: true`                                                                                    |
| `'2026-08-29'`   | Also sets `cookieWinsOnConflict: true`                                                                                                   |
| `'2026-08-30'`   | Also sets `session_recording.captureJsonLd: true`                                                                                        |

Each snapshot includes the changes of every earlier snapshot. The `'2026-01-30'` change avoids SSR hydration errors. Set `defaults` to `'<ph_posthog_js_defaults>'` to use the most recent defaults.

## Capture custom events

By default, PostHog captures pageviews and pageleaves. It also captures clicks, input changes, and form submissions on `a`, `button`, `form`, `input`, `select`, `textarea`, and `label` tags. See the [autocapture docs](https://posthog.com/docs/product-analytics/autocapture) for details.

To disable or filter these events, set the matching options in [Configure the SDK](#configure-the-sdk).

Send your own events with `capture`:

```js
posthog.capture('user_signed_up')
```

> **Tip.** Use an `[object] [verb]` format for your event names. `[object]` is the entity the behavior relates to, and `[verb]` is the behavior itself. For example, `project created`, `user signed up`, or `invite sent`.

> **Tip.** You can define event schemas with typed properties and generate type-safe code with [schema management](https://posthog.com/docs/product-analytics/schema-management).

To include more information with the event, pass a [properties](https://posthog.com/docs/data/events#event-properties) object:

```js
posthog.capture('user_signed_up', {
    login_type: 'email',
    is_free_trial: true,
})
```

## Send events before unload

The third argument to `posthog.capture()` accepts a `transport` option. `transport: "sendBeacon"` tells PostHog to use the browser's [`navigator.sendBeacon`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon) API for that request.

```js
posthog.capture('user_clicked_reload', { button: 'reload' }, { transport: 'sendBeacon', send_instantly: true })

window.location.reload()
```

`transport` only chooses the network transport. It doesn't skip PostHog's event queue, and it doesn't force queued events to send immediately. If `request_batching` is enabled, PostHog batches events by default and flushes them on an interval. To send one event immediately, pass `send_instantly: true` in the capture options, as shown above.

For page unloads and reloads:

- **The event before navigation.** Use `{ transport: "sendBeacon", send_instantly: true }` for the event you need to send right before navigation.
- **No flush call.** You don't need to call `posthog.flush()` for browser event capture. The browser SDK has no public `flush()` method for custom events.
- **Queued events.** With batching enabled, the SDK also tries to flush queued events with `sendBeacon` during page unload. This helps with events already in the queue. For critical events right before navigation, use `send_instantly: true`.
- **Delivery.** `sendBeacon` improves reliability during unload, but the browser and the network still control delivery.

## The two event types

PostHog captures two types of events: [anonymous and identified](https://posthog.com/docs/data/anonymous-vs-identified-events).

**Identified events** let you attribute events to specific users and attach [person properties](https://posthog.com/docs/product-analytics/person-properties). They suit logged-in users. Capture identified events when you:

- Track logged-in users in B2B and B2C SaaS apps
- Do user-segmented product analysis
- Analyze the complete conversion lifecycle, as growth and marketing teams do

**Anonymous events** are events without individually identifiable data. They suit [web analytics](https://posthog.com/docs/web-analytics) and apps where users aren't logged in. Capture anonymous events when you:

- Track a marketing website
- Run a content-focused site
- Run a B2C app where users don't sign up or log in

The key difference is that PostHog creates a [person profile](https://posthog.com/docs/data/persons) for identified events, and doesn't for anonymous events.

> **Important.** Anonymous events cost less to process, so they can be up to 4x cheaper than identified events. Capture identified events only when you need them.

The JavaScript Web SDK captures anonymous events by default. The `person_profiles` option changes this when you initialize PostHog:

- **`person_profiles: 'identified_only'`.** This is the default, and we recommend it. PostHog captures anonymous events by default. It captures identified events only for users who already have a [person profile](https://posthog.com/docs/data/persons).
- **`person_profiles: 'always'`.** PostHog captures identified events for all events.

For example:

```js
posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    defaults: '<ph_posthog_js_defaults>',
    person_profiles: 'always',
})
```

With `identified_only`, call any of these functions to capture identified events:

- [`identify()`](https://posthog.com/docs/product-analytics/identify)
- [`alias()`](https://posthog.com/docs/product-analytics/identify#alias-assigning-multiple-distinct-ids-to-the-same-user)
- [`group()`](https://posthog.com/docs/product-analytics/group-analytics)
- [`setPersonProperties()`](https://posthog.com/docs/product-analytics/person-properties)
- [`setGroupPropertiesForFlags()`](#override-flag-properties)

Each of these functions creates a [person profile](https://posthog.com/docs/data/persons) for the user. Once the profile exists, PostHog captures all later events for this user as identified events.

[`setPersonPropertiesForFlags()`](https://posthog.com/docs/feature-flags/property-overrides#manual-overrides-with-setpersonpropertiesforflags) is the exception. It doesn't create a person profile, so you can use it to target feature flags on person properties while the user is still anonymous.

## Link events to users

> **Identifying users is required.** Call `posthog.identify('your-user-id')` after login to link events to a known user. This connects frontend event captures, [session replays](https://posthog.com/docs/session-replay), [LLM traces](https://posthog.com/docs/ai-engineering), and [error tracking](https://posthog.com/docs/error-tracking) to the same person. It also lets backend events link back.
>
> Use a stable ID from your auth system when you can, not an email or display name. Send those as person properties instead. If your app has no other stable key, a unique email works as a fallback. Never use a shared literal like `"anonymous"` or `"user"`. It pools many people onto one person and corrupts their data. When no ID is available at all, skip the identify call and keep the anonymous distinct ID that PostHog assigns.
>
> Call `posthog.reset()` on logout, so the next person to use the browser doesn't inherit the last one's identity.
>
> See the guide on [identifying users](https://posthog.com/docs/getting-started/identify-users) for how to set this up.

`identify` captures identified events for a specific user. You can then see how they use your product across sessions, devices, and platforms. Read the doc on [identifying users](https://posthog.com/docs/product-analytics/identify) to use it correctly.

```js
posthog.identify(
    'distinct_id', // Required. Replace 'distinct_id' with your user's unique identifier
    { email: 'max@hedgehogmail.com', name: 'Max Hedgehog' }, // $set, optional
    { first_visited_url: '/blog' } // $set_once, optional
)
```

Calling `identify` creates a person profile if one doesn't exist. All events for that distinct ID then count as identified events.

To get the distinct ID of the current user, call `posthog.get_distinct_id()`.

If your app already knows the signed-in user when PostHog initializes, you can [call `identify` from the `loaded` callback](https://posthog.com/docs/getting-started/identify-users#identify-users-when-the-web-sdk-loads). This identifies them as soon as the web SDK loads.

> **Note.** `identify()` is for analytics. It links events to a user and creates person profiles. `setIdentity()` is different. It's for [Support ticket verification](https://posthog.com/docs/support/widget#identity-verification) with HMAC signing.

## Set person properties

To set [person properties](https://posthog.com/docs/product-analytics/person-properties) on a person profile, include them when you capture an event:

```js
posthog.capture('event_name', {
    $set: { name: 'Max Hedgehog' },
    $set_once: { initial_url: '/blog' },
})
```

You usually set person properties when an event occurs, like `user updated email`. Sometimes you want to set person properties as their own event.

```js
posthog.setPersonProperties(
    { name: 'Max Hedgehog' }, // These properties are like the `$set` from above
    { initial_url: '/blog' } // These properties are like the `$set_once` from above
)
```

This sends a special `$set` event to PostHog. For the difference between `$set` and `$set_once`, see the [person properties docs](https://posthog.com/docs/product-analytics/person-properties#what-is-the-difference-between-set-and-set_once).

To remove person properties, use `unsetPersonProperties()`. See [person properties](https://posthog.com/docs/product-analytics/person-properties#how-to-remove-person-properties) for examples.

## Reset on logout

When a user logs out or switches accounts, call `reset` to unlink future events on that device from that user. This stops PostHog from grouping several users together because of shared cookies between sessions. Call `reset` on logout even if you don't expect users to share a computer.

```js
posthog.reset()
```

To also reset `device_id`, pass `true`:

```js
posthog.reset(true)
```

`reset` also resets group analytics.

## Alias a user

Sometimes you want to assign more than one distinct ID to a single user. This helps when your primary distinct ID is inaccessible. For example, a distinct ID you use on the frontend isn't available in your backend.

Use `alias` to assign another distinct ID to the same user.

```js
posthog.alias('alias_id', 'distinct_id')
```

Read the docs on [alias](https://posthog.com/docs/product-analytics/identify#alias-assigning-multiple-distinct-ids-to-the-same-user) to use this method correctly.

## Use group analytics

[Group analytics](https://posthog.com/docs/product-analytics/group-analytics) associates the events of a person's session with a group, like a team or an organization.

> **Note.** Group analytics is a paid feature. It isn't available on the free cloud plan. See the [pricing page](https://posthog.com/pricing).

Call the `group` method with a group type and a group ID.

```js
posthog.group('company', 'company_id_in_your_db')

posthog.capture('upgraded_plan') // this event is associated with company ID `company_id_in_your_db`
```

To set group properties, pass a third argument to `group`.

```js
posthog.group('company', 'company_id_in_your_db', {
    name: 'Awesome Inc.',
    employees: 11,
})
```

`name` is a special property. PostHog shows it as the name of the group. If you don't set `name`, PostHog shows the group ID instead.

## Register super properties

Super properties are event properties that you set once. PostHog then sends them with every `capture` call across sessions, whether it's a `$pageview`, an autocaptured button click, or anything else.

Set them with `posthog.register`, which takes a properties object:

```js
posthog.register({
    'icecream_pref': 'vanilla',
})
```

After this call, every event includes an `"icecream_pref": "vanilla"` property. If you filter events by `icecream_pref = vanilla`, you see all events captured for that user after the `posthog.register` call.

This doesn't set a person property or a group property. It only sets properties on events.

If you register the same property again, the next event uses the new value. To register a property only once, for example for ad campaign properties, use `register_once`:

```js
posthog.register_once({
    'campaign_source': 'twitter',
})
```

`register_once` doesn't set a property that is already set. For example, if the user already has `"icecream_pref": "vanilla"`, calling `posthog.register_once({"icecream_pref": "chocolate"})` doesn't update the property.

Super properties create a cookie on the client that holds the properties and their values. To stop sending a super property and remove it from the cookie, use `posthog.unregister`:

```js
posthog.unregister('icecream_pref')
```

Later events don't include the super property.

## Use feature flags

PostHog's [feature flags](https://posthog.com/docs/feature-flags) let you safely deploy and roll back new features, and target specific users and groups with them.

For a boolean feature flag:

```js
const result = posthog.getFeatureFlagResult('flag-key')
if (result?.enabled) {
    // Do something differently for this user

    // Optional: fetch the payload from the same evaluation result
    const matchedFlagPayload = result?.payload
}
```

For a multivariate feature flag:

```js
const result = posthog.getFeatureFlagResult('flag-key')
if (result?.variant == 'variant-key') {
    // replace 'variant-key' with the key of your variant
    // Do something differently for this user

    // Optional: fetch the payload from the same evaluation result
    const matchedFlagPayload = result?.payload
}
```

To inspect all loaded feature flags, call `getAllFeatureFlags()`. It returns each flag's `key`, `enabled` state, `variant`, and `payload`. It doesn't send a `$feature_flag_called` event, so it doesn't affect your experiment results or flag usage analytics.

```js
for (const flag of posthog.getAllFeatureFlags()) {
    console.log(flag.key, flag.enabled, flag.variant, flag.payload)
}
```

## Wait for flags

Every time a user loads a page, PostHog sends a background request to fetch the feature flags that apply to that user. It stores those flags in your chosen persistence option, which is local storage by default.

So on most pages the feature flags are available immediately. The exception is the first time a user visits.

To handle this, use the `onFeatureFlags` callback to wait for the feature flag request to finish:

```js
posthog.onFeatureFlags(function (flags, flagVariants, { errorsLoading }) {
    // feature flags are guaranteed to be available at this point
    if (posthog.isFeatureEnabled('flag-key')) {
        // do something
    }
})
```

The callback receives these parameters:

- **`flags: string[]`.** The feature flags that apply to the user.
- **`flagVariants: Record<string, string | boolean>`.** The variants that apply to the user.
- **`{ errorsLoading }: { errorsLoading?: boolean }`.** Whether an error occurred during the request to load the feature flags. It's `true` if the request timed out or failed. It's `false` or `undefined` if the request succeeded.

You don't usually need these parameters. They help when you want to handle flags that didn't load because of a network error or a timeout (see `feature_flag_request_timeout_ms`).

## Evaluate specific flags

By default, the SDK asks PostHog to evaluate every eligible feature flag for the current user. To evaluate and return only some flags, pass `flag_keys` when you initialize PostHog:

```js
posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    defaults: '<ph_posthog_js_defaults>',
    flag_keys: ['checkout-flow', 'new-dashboard'],
})
```

PostHog scopes evaluation and the response to those keys for this SDK instance. It can also evaluate and return dependency flags that the requested flags need. Leave `flag_keys` unset to evaluate all eligible flags.

## Reload feature flags

PostHog caches feature flag values. If something changed for your user and you want to fetch their flag values again, call:

```js
posthog.reloadFeatureFlags()
```

## Override flag properties

Sometimes you want to evaluate feature flags with properties that PostHog hasn't ingested yet, or that were set incorrectly earlier. Set the properties the flag depends on with these calls:

```js
posthog.setPersonPropertiesForFlags({ 'property1': 'value', property2: 'value2' })
```

> **Note.** These properties are set for the entire session. Successive calls are additive. PostHog combines all the properties you set and sends them for flag evaluation.

When you set these properties, PostHog also reloads feature flags to get the latest values. To skip the reload, pass `false` as the second parameter:

```js
posthog.setPersonPropertiesForFlags({ 'property1': 'value', property2: 'value2' }, false)
```

To reset these properties, call `resetPersonPropertiesForFlags`:

```js
posthog.resetPersonPropertiesForFlags()
```

The same works for [group](https://posthog.com/docs/product-analytics/group-analytics) properties:

```js
// set properties for a group
posthog.setGroupPropertiesForFlags({ 'company': { 'property1': 'value', property2: 'value2' } })

// reset properties for a given group:
posthog.resetGroupPropertiesForFlags('company')

// reset properties for all groups:
posthog.resetGroupPropertiesForFlags()
```

> **Note.** You don't need to add the group names here. PostHog attaches these properties to the current group, which you set with `posthog.group()`. When you change the group, PostHog resets these properties.

**Automatic overrides.** When you call `posthog.identify` with person properties, PostHog adds those properties to flag evaluation calls to help it pick the correct flag values. The same is true when you call `posthog.group()`.

**Default overridden properties.** PostHog always overrides these properties based on the user's IP address:

1. `$geoip_city_name`
2. `$geoip_country_name`
3. `$geoip_country_code`
4. `$geoip_continent_name`
5. `$geoip_continent_code`
6. `$geoip_postal_code`
7. `$geoip_time_zone`

So geolocation-based flags work without you setting these properties.

## Set a flag timeout

Set `feature_flag_request_timeout_ms` when you initialize PostHog to set a timeout for flag requests. This stops a slow response from PostHog's servers from blocking your code. The default is 3 seconds.

```js
posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    defaults: '<ph_posthog_js_defaults>',
    feature_flag_request_timeout_ms: 3000, // Time in milliseconds. Default is 3000 (3 seconds).
})
```

## Bootstrap feature flags

There's a delay between initializing PostHog and fetching feature flags, so flags aren't always available immediately. You can't use them for something like redirecting a user to a different page based on a flag.

To have your feature flags available immediately, initialize PostHog with precomputed values. This is called bootstrapping. After the SDK fetches feature flags from PostHog, it uses those values instead of the bootstrapped ones.

See the [bootstrapping guide](https://posthog.com/docs/feature-flags/bootstrapping) for how to implement it.

## Supply your own flags

You can evaluate feature flags outside the SDK, for example on your own server with [`posthog-node` local evaluation](https://posthog.com/docs/feature-flags/local-evaluation), and pass the results to the browser. The SDK can then use those values instead of requesting flags.

Set `advanced_disable_feature_flags: true` so PostHog stops evaluating feature flags. The reloads that `identify()`, `group()`, and `setPersonProperties()` trigger then no longer fetch flags. Push your evaluated flags at runtime with `updateFlags(flags, payloads?, { merge })`:

```js
posthog.init('<ph_project_token>', {
    // Don't evaluate flags in the browser – we supply them ourselves.
    advanced_disable_feature_flags: true,
    // Optional: values that must be available on load, before updateFlags() runs.
    bootstrap: {
        featureFlags: { 'my-flag': true },
        featureFlagPayloads: { 'my-flag': { color: 'blue' } },
    },
})

// Later – e.g. after login, once your backend has evaluated flags for this user:
posthog.updateFlags({ 'my-flag': true, 'my-variant-flag': 'test' }, { 'my-flag': { color: 'blue' } })

posthog.getFeatureFlag('my-variant-flag') // 'test'
posthog.getFeatureFlagResult('my-flag')?.payload // { color: 'blue' }
```

`updateFlags` replaces the stored flags by default. Pass `{ merge: true }` to merge into the existing set instead. Use `bootstrap` for any flag values that must be available on first load, before `updateFlags()` runs.

Surveys rely on feature flags internally, so `advanced_disable_feature_flags` also disables surveys. If you use surveys, set `advanced_only_evaluate_survey_feature_flags: true` instead. PostHog then evaluates only survey-related flags.

## Send enriched flag analytics

You can send enriched analytics data for feature flags. It helps you find replays where people interact with a flag, target people who interacted with a feature, or build cohorts of people who viewed a feature.

These events also add two charts to the flag's [**Usage** tab](https://posthog.com/docs/feature-flags/surfaces/web-app#see-how-a-flag-is-used), one for views and one for interactions. You can compare how many people saw a feature against how many used it. PostHog checks for these events periodically, so the charts don't appear immediately.

To enable this, use the `<PosthogFeature>` [React component](https://posthog.com/docs/libraries/react#method-2-using-the-posthogfeature-component), which implements it for you, or implement it yourself.

To implement it yourself:

1. When a feature is viewed, send the `$feature_view` event with the property `feature_flag` set to the name of the flag.

```javascript
posthog.capture('$feature_view', { feature_flag: flag })
```

2. When someone interacts with a feature, send a `$feature_interaction` event with the property `feature_flag` set to the name of the flag.

3. At the same time, set the person property `$feature_interaction/<flag-key>` to true.

```javascript
posthog.capture('$feature_interaction', {
    feature_flag: flag,
    $set: { [`$feature_interaction/${flag}`]: true },
})
```

See [the React component](https://github.com/PostHog/posthog-js/blob/main/packages/react/src/components/PostHogFeature.tsx) for another example.

## Run experiments

[Experiments](https://posthog.com/docs/experiments/start-here) use feature flags, so the code for an experiment is very similar to the feature flag code:

```js
// Ensure flags are loaded before usage.
// You'll only need to call this on the code the first time a user visits.
// See this doc for more details: /docs/feature-flags/manual#ensuring-flags-are-loaded-before-usage
posthog.onFeatureFlags(function () {
    // feature flags should be available at this point
    if (posthog.getFeatureFlag('experiment-feature-flag-key') == 'variant-name') {
        // do something
    }
})

// Otherwise, you can just do:
if (posthog.getFeatureFlag('experiment-feature-flag-key') == 'variant-name') {
    // do something
}

// You can also test your code by overriding the feature flag:
// e.g., posthog.featureFlags.overrideFeatureFlags({ flags: {'experiment-feature-flag-key': 'test'}})
```

You can also [run experiments without feature flags](https://posthog.com/docs/experiments/running-experiments-without-feature-flags).

## Manage early access features

Early access features let you release feature flags that your users control. See the [early access feature management guide](https://posthog.com/docs/feature-flags/early-access-feature-management).

```js
posthog.getEarlyAccessFeatures((previewItemData) => {
    // do something with early access feature
})
```

```js
posthog.updateEarlyAccessFeatureEnrollment(flagKey, true)
```

## Show surveys

PostHog shows [surveys](https://posthog.com/docs/surveys) with [popover presentation](https://posthog.com/docs/surveys/creating-surveys#presentation) to users who match the [display conditions](https://posthog.com/docs/surveys/creating-surveys#display-conditions) you set up.

You can also [render unstyled surveys programmatically](https://posthog.com/docs/surveys/implementing-custom-surveys) with the `renderSurvey` method.

```js
posthog.renderSurvey('survey_id', '#survey-container')
```

To stop a specific client from loading surveys, set the `disable_surveys` option. See [Configure the SDK](#configure-the-sdk).

Surveys with the **API** presentation let you build your own survey UI. PostHog handles display logic, result capture, and analytics.

To implement API surveys, first fetch the active surveys for a user with either of these methods:

```js
// Fetch enabled surveys for the current user
posthog.getActiveMatchingSurveys(callback, forceReload)

// Fetch all surveys
posthog.getSurveys(callback, forceReload)
```

The response is an array of survey objects, and PostHog caches it by default. To force a reload, pass `true` as the `forceReload` argument.

The survey objects look like this:

```json
[
    {
        "id": "your_survey_id",
        "name": "Your survey name",
        "description": "Metadata describing your survey",
        "type": "api", // either "api", "popover", or "widget"
        "linked_flag_key": null, // linked feature flag key, if any.
        "targeting_flag_key": "your_survey_targeting_flag_key",
        "questions": [
            {
                "type": "single_choice",
                "choices": ["Yes", "No"],
                "question": "Are you enjoying PostHog?"
            }
        ],
        "conditions": null,
        "start_date": "2023-09-19T13:10:49.505000Z",
        "end_date": null
    }
]
```

## Capture survey events

To capture survey results correctly, capture three types of events:

```js
// 1. When a user is shown a survey
posthog.capture('survey shown', {
    $survey_id: survey.id, // required
})

// 2. When a user has dismissed a survey
posthog.capture('survey dismissed', {
    $survey_id: survey.id, // required
})

// 3. When a user has responded to a survey
posthog.capture('survey sent', {
    $survey_id: survey.id, // required
    $survey_questions: [
        {
            id: 'd8462827-1575-4e1e-ab1d-b5fddd9f829c',
            question: 'What is your favorite color?',
        },
    ],
    '$survey_response_d8462827-1575-4e1e-ab1d-b5fddd9f829c': survey_response, // required. `survey_response` must be a text value.
    // Convert numbers to text e.g. 8 should be converted to "8".
    // For multiple choice select surveys, `survey_response` must be an array of values with the selected choices.
    // e.g., '$survey_response_d8462827-1575-4e1e-ab1d-b5fddd9f829c': ["response_1", "response_2"]
})
```

## Control session replay

To set up [session replay](https://posthog.com/docs/session-replay), install the JavaScript Web SDK and enable "Record user sessions" in [your project settings](https://app.posthog.com/settings/project-replay).

To [control which sessions you record](https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record), you have these options:

- [Feature flags](https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record#feature-flag-triggers)
- [Sampling](https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record#sampling)
- [Minimum duration](https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record#minimum-duration)
- The `disable_session_recording` option with the methods below

```js
// Turns session recording on
posthog.startSessionRecording()

// Turns session recording off
posthog.stopSessionRecording()

// Check if session recording is currently running
posthog.sessionRecordingStarted()
```

If you use feature flags or sampling to control which sessions you record, you can override that and start a recording anyway. Pass the `linked_flag` or `sampling` overrides. This starts a recording for all users, even if they don't match the flag or aren't in the sample:

```js
posthog.startSessionRecording({ linked_flag: true, sampling: true })
```

**Replay triggers.** You can configure replay triggers in your [project settings](https://app.posthog.com/project/settings). A URL trigger enables or pauses session recording when the user visits a page that matches the URLs you configure. An event trigger starts session recording immediately before PostHog queues any of the events you configure.

To get the playback URL of the current session replay, use this method:

```js
posthog.get_session_replay_url({ withTimestamp: true, timestampLookBack: 30 })
```

It has two optional parameters:

- **`withTimestamp`** (default: `false`). When `true`, the URL includes a timestamp that takes you to the session at the time of the event.
- **`timestampLookBack`** (default: `10`). The number of seconds back that the timestamp links to.

Session replay uses [rrweb](https://github.com/rrweb-io/rrweb), which you configure with the `session_recording` option. The [rrweb docs](https://github.com/rrweb-io/rrweb/blob/master/guide.md#options) list these options and their defaults.

The defaults are the same as in rrweb, except for these fields:

| Key             | PostHog default     |
| --------------- | ------------------- |
| `blockClass`    | `'ph-no-capture'`   |
| `ignoreClass`   | `'ph-ignore-input'` |
| `maskTextClass` | `'ph-mask'`         |
| `maskAllInputs` | `true`              |

`blockClass`, `ignoreClass`, and `maskTextClass` take a string or a RegExp. They set which elements rrweb blocks, ignores, and masks. See the rrweb [privacy](https://github.com/rrweb-io/rrweb/blob/master/guide.md#privacy) chapter. `maskAllInputs` masks all input content as `*`.

The defaults for `maskAllInputs`, `maskTextSelector`, and `blockSelector` change with the masking configuration in the session replay section of [your project settings](https://app.posthog.com/settings/project-replay#replay-masking).

## Capture exceptions

You can enable [exception autocapture](https://posthog.com/docs/error-tracking/installation) in the **Error tracking** section of [your project settings](https://app.posthog.com/settings/project-error-tracking#error-tracking-exception-autocapture). PostHog then captures `$exception` events when errors are thrown.

You can also capture exceptions manually with the `captureException` method:

```js
posthog.captureException(error, additionalProperties)
```

## Capture logs

The browser SDK supports [PostHog Logs](https://posthog.com/docs/logs). It sends structured records with `posthog.logger.*` and `posthog.captureLog`, and can autocapture `console.*` calls. For setup, manual flushing, and the full config reference, see the [JavaScript web logs installation guide](https://posthog.com/docs/logs/installation/javascript).

## Amend events before sending

From 1.187.0, you can pass a `before_send` function when you initialize the SDK. It lets you amend, filter, sample, or reject events before they're sent to PostHog.

> **Warning.** Amending and sampling events is advanced functionality that needs careful implementation. Core PostHog features can need 100% of unmodified events to work. Modify or sample only your own custom events if you can, and keep all PostHog internal events in their original form.

`before_send` gives you one place to edit or redact information before it's sent to PostHog.

This example redacts URLs in event properties:

```ts
posthog.init('<ph_project_token>', {
    before_send: (event: CaptureResult | null): CaptureResult | null => {
        if (!event) {
            return null
        }

        // redacting URLs will be specific to your site structure
        function redactUrl(value: string): string {
            return value.replace(/project\/\d+/, 'project/1234567')
        }

        // NB these functions are examples and you should implement something specific to your site
        // redacting information can impact features that rely on it, e.g. heatmaps are keyed by URL
        function redactArray(value: any[]) {
            return value.map((v) => {
                if (typeof v === 'string') {
                    return redactUrl(v)
                } else if (Array.isArray(v)) {
                    return redactArray(v)
                } else if (typeof v === 'object' && v) {
                    return redactObject(v)
                } else {
                    return v
                }
            })
        }

        // NB these functions are examples and you should implement something specific to your site
        // redacting information can impact features that rely on it, e.g. heatmaps are keyed by URL
        function redactObject(objectToRedact: Record<string, any>): Record<string, any> {
            return Object.entries(objectToRedact).reduce((acc, [key, value]) => {
                if ((key.includes('url') || key.includes('href')) && typeof value === 'string') {
                    acc[key] = redactUrl(value)
                } else if (Array.isArray(value)) {
                    acc[key] = redactArray(value)
                } else if (typeof value === 'object' && value) {
                    acc[key] = redactObject(value)
                } else {
                    acc[key] = value
                }
                return acc
            }, {})
        }

        const redactedProperties = redactObject(event.properties || {})
        event.properties = redactedProperties

        const redactedSet = redactObject(event.$set || {})
        event.$set = redactedSet

        const redactedSetOnce = redactObject(event.$set_once || {})
        event.$set_once = redactedSetOnce

        return event
    },
})
```

This example redacts person properties in `$set` or `$set_once`:

```ts
posthog.init('<ph_project_token>', {
    before_send: (event: CaptureResult | null): CaptureResult | null => {
        if (!event) {
            return null
        }

        event.$set = {
            ...event.$set,
            name: 'secret name',
        }
        event.$set_once = {
            ...event.$set_once,
            initial_name: 'secret name',
        }

        return event
    },
})
```

## Sample events

Sampling sends only a percentage of events to PostHog. It controls your costs without turning SDK features off.

Some PostHog functions, like much of web analytics, rely on receiving all events. Sampling `$pageview` or `$pageleave` events in particular can cause unexpected results.

PostHog has pre-built sampling functions. You can sample by event name, distinct ID, session ID, or a custom function. For each one, import it with a package manager, or add the customization script to your site.

**Sample by event name.** Use `sampleByEvent`. With the import:

```ts
import { sampleByEvent } from 'posthog-js/customizations'

posthog.init('<ph_project_token>', {
    // capture only half of dead click and web vitals events
    before_send: sampleByEvent(['$dead_click', '$web_vitals'], 0.5),
})
```

With the script:

```tsx
// Add this script to your site, may need to change the script src to match your API host:
// <script type="text/javascript" src="https://us.i.posthog.com/static/customizations.full.js"></script>

posthog.init('<ph_project_token>', {
    // capture only half of dead click and web vitals events
    before_send: posthogCustomizations.sampleByEvent(['$dead_click', '$web_vitals'], 0.5),
})
```

**Sample by distinct ID.** Use `sampleByDistinctId` to sample a percentage of events by person distinct ID. This example keeps 40% of events. A given distinct ID always sends either all events or no events. With the import:

```ts
import { sampleByDistinctId } from 'posthog-js/customizations'

posthog.init('<ph_project_token>', {
    before_send: sampleByDistinctId(0.4),
})
```

With the script:

```ts
// Add this script to your site, may need to change the script src to match your API host:
// <script type="text/javascript" src="https://us.i.posthog.com/static/customizations.full.js"></script>

posthog.init('<ph_project_token>', {
    before_send: posthogCustomizations.sampleByDistinctId(0.4),
})
```

**Sample by session ID.** Use `sampleBySessionId` to sample a percentage of events by session ID. This example keeps 25% of events. A given session ID always sends either all events or no events. With the import:

```ts
import { sampleBySessionId } from 'posthog-js/customizations'

posthog.init('<ph_project_token>', {
    before_send: sampleBySessionId(0.25),
})
```

With the script:

```ts
// Add this script to your site, may need to change the script src to match your API host:
// <script type="text/javascript" src="https://us.i.posthog.com/static/customizations.full.js"></script>

posthog.init('<ph_project_token>', {
    before_send: posthogCustomizations.sampleBySessionId(0.25),
})
```

**Sample with a custom function.** If none of the pre-built functions fit, write your own:

```ts
posthog.init('<ph_project_token>', {
    before_send: (event: CaptureResult | null): CaptureResult | null => {
        if (!event) {
            return null
        }

        let sampleRate = 1.0 // default to always returning the event
        if (event.event === '$heatmap') {
            sampleRate = 0.1
        }
        if (event.event === '$dead_click') {
            sampleRate = 0.01
        }
        return Math.random() < sampleRate ? event : null
    },
})
```

## Chain before_send functions

You can pass an array of functions. PostHog calls them one after the other:

```ts
posthog.init('<ph_project_token>', {
    before_send: [
        sampleByDistinctId(0.5), // only half of people
        sampleByEvent(['$web_vitals'], 0.1), // and they capture all events except 10% of web vitals
        sampleByEvent(['$$heatmap'], 0.5), // and 50% of heatmaps
    ],
})
```

## Block bad actors

PostHog tries to block known crawlers and web and AI agents. But not every crawler advertises itself as a crawler.

If you see an unusual number of visitors in your project, use [web analytics](https://us.posthog.com/web) to find where they come from. Often they all have the exact same user agent string. To check the most common user agents, use [this trend insight](https://app.posthog.com/insights/new#q=%7B%22kind%22%3A%22InsightVizNode%22%2C%22source%22%3A%7B%22kind%22%3A%22TrendsQuery%22%2C%22series%22%3A%5B%7B%22kind%22%3A%22EventsNode%22%2C%22name%22%3A%22%24pageview%22%2C%22event%22%3A%22%24pageview%22%2C%22math%22%3A%22total%22%7D%5D%2C%22trendsFilter%22%3A%7B%7D%2C%22breakdownFilter%22%3A%7B%22breakdowns%22%3A%5B%7B%22property%22%3A%22%24raw_user_agent%22%2C%22type%22%3A%22event%22%7D%5D%7D%7D%7D%20).

If one user agent causes problems, with many more events than other user agents, block it. Add it to `custom_blocked_useragents` when you initialize PostHog:

```ts
posthog.init('<ph_project_token>', {
    custom_blocked_useragents: ['<user_agent_string>'],
})
```

**Lighthouse audits.** Lighthouse doesn't advertise itself. If you use a tool that monitors your website with Lighthouse, or a competitor does, PostHog can't block those events by default, which can skew your numbers. Ahrefs and Semrush are examples.

Lighthouse user agents are well known. PostHog doesn't block them by default because they can be real users. If you get a high number of events from these sources, add them to your `custom_blocked_useragents` list:

```ts
const LIGHTHOUSE_USER_AGENTS = [
    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
]

posthog.init('<ph_project_token>', {
    custom_blocked_useragents: LIGHTHOUSE_USER_AGENTS,
})
```

**Events already ingested.** Deleting ingested events is complicated. Instead, add the user agents to the [internal and test accounts filter](https://app.posthog.com/settings/project-customization#internal-user-filtering) in your project settings to filter them from your analytics.

## Use debug mode

If you don't see the events, feature flag evaluations, or surveys you expect, enable debug mode to see what's happening.

Set the `debug` option to `true` in the `init` call. A common pattern is to set it to `true` only in development environments, with environment variables.

```ts
posthog.init('<ph_project_token>', {
    debug: true, // Set this to true in development environments only using environment variables
})
```

This enables verbose logs about the inner workings of the SDK.

You can also call `posthog.debug()` at runtime, in your code or in a dev console like Chrome DevTools or Firefox Developer Tools.

```ts
posthog.debug()
```

If you can't access or update your code, append `?__posthog_debug=true` to the URL of your website. You can try this on the PostHog website:

```text
https://posthog.com/?__posthog_debug=true
```

After you enable debug mode, the developer console shows PostHog logs. When you contact support, include the debug logs from the developer console. They help us diagnose the issue faster.

## Expose the posthog global

Sometimes you want to test PostHog directly in the browser's dev console, with commands like `posthog.capture('test event')`.

The SDK exposes the `window.posthog` global object on some sites. Most modern web apps, like React and Vue apps, don't expose it.

To expose PostHog in the browser:

1. Enable debug mode by setting `debug: true` in your config.
2. In the browser console, search for the log message `[PostHog.js] Starting in debug mode`.
3. Expand the logged object.
4. Right-click `this` and pick **Store as global variable**.

You can then access `posthog` as `temp0` in Firefox and `temp1` in Chrome. For example, run `temp1.capture('test event')` in the console.

> **Note.** This was tested in Chrome and Firefox. Safari doesn't have this feature. Other Chromium and Gecko browsers do.

## Opt out of capture

You can opt users out of data capture completely. There are two ways.

1. Opt users out by default. Set `opt_out_capturing_by_default` to `true` in your config.

```js
posthog.init('<ph_project_token>', {
    opt_out_capturing_by_default: true,
})
```

2. Opt users out per person. Call `posthog.opt_out_capturing()`.

To opt a user in:

```js
posthog.opt_in_capturing()
```

To check if a user is opted out:

```js
posthog.has_opted_out_capturing()
```

## Run multiple instances

PostHog lets you run more than one instance at the same time, though it isn't a first-class feature. For example, you can track different events in different PostHog projects.

`posthog.init` accepts a third parameter that creates a named instance.

```ts
posthog.init('<ph_project_token>', {}, 'project1')
posthog.init('<ph_project_token>', {}, 'project2')
```

Call each instance through the global `posthog` object:

```ts
posthog.project1.capture('some_event')
posthog.project2.capture('other_event')
```

> **Note.** You probably want to disable autocapture, and some other events, so they aren't sent to both instances. See [Configure the SDK](#configure-the-sdk).

## Develop the SDK

To run `posthog-js` locally and set up your development environment, see the README in the [posthog-js](https://github.com/PostHog/posthog-js#README) repository.

## Configure the SDK

When you call `posthog.init`, you can set configuration options to control how PostHog behaves. This example sets the options most projects decide on:

```js
posthog.init('<ph_project_token>', {
    api_host: 'https://us.i.posthog.com',
    defaults: '<ph_posthog_js_defaults>',
    autocapture: false,
    capture_pageview: 'history_change',
    disable_session_recording: true,
    enable_recording_console_log: true,
    capture_heatmaps: true,
    disable_surveys: true,
    advanced_disable_feature_flags: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    opt_out_capturing_by_default: true,
    persistence: 'memory',
    cross_subdomain_cookie: false,
    secure_cookie: true,
    person_profiles: 'always',
})
```

Leave a line out to keep the default. Each line does this:

| Line                                   | What it does                                                          |
| -------------------------------------- | --------------------------------------------------------------------- |
| `api_host: 'https://us.i.posthog.com'` | Sends data to US Cloud                                                |
| `api_host: 'https://eu.i.posthog.com'` | Sends data to EU Cloud                                                |
| `defaults`                             | Uses the latest recommended behaviors                                 |
| `autocapture: false`                   | Stops autocapture of clicks, form submissions, and other interactions |
| `capture_pageview: 'history_change'`   | Detects page changes with the history API, for single-page apps       |
| `disable_session_recording: true`      | Stops recording user sessions for replay                              |
| `enable_recording_console_log: true`   | Includes browser console logs in session recordings                   |
| `capture_heatmaps: true`               | Captures click positions for heatmaps                                 |
| `disable_surveys: true`                | Stops loading the surveys script                                      |
| `advanced_disable_feature_flags: true` | Stops requesting and evaluating feature flags                         |
| `mask_all_text: true`                  | Stops autocapture from capturing element text                         |
| `mask_all_element_attributes: true`    | Removes all element attributes from autocapture data                  |
| `opt_out_capturing_by_default: true`   | Requires an explicit opt-in before tracking                           |
| `persistence`                          | Sets how PostHog stores user identity                                 |
| `cross_subdomain_cookie: false`        | Stops sharing identity across subdomains                              |
| `secure_cookie: true`                  | Sends cookies only over HTTPS connections                             |
| `person_profiles: 'always'`            | Creates profiles for all users, not just identified ones              |

`advanced_disable_feature_flags: true` also disables surveys.

Add the code to your app where you initialize PostHog.

You can also change the configuration after initialization with the `posthog.set_config` method.

```ts
posthog.set_config({
    persistence: 'localStorage+cookie',
})
```

There are many configuration options, and you never need most of them. The [`PostHogConfig` type](https://posthog.com/docs/libraries/js/reference#posthogconfig) in this reference is generated from the SDK source. It lists every supported public option with its description.

These are the most relevant options:

| Option                               | Type                                     | Default                     |
| ------------------------------------ | ---------------------------------------- | --------------------------- |
| `api_host`                           | String                                   | `https://us.i.posthog.com`  |
| `ui_host`                            | String                                   | `null`                      |
| `autocapture`                        | Boolean or `AutocaptureConfig`           | `true`                      |
| `before_send`                        | Function or array of functions           | `undefined`                 |
| `bootstrap`                          | Object                                   | `{}`                        |
| `capture_pageview`                   | Boolean or String                        | `true`                      |
| `capture_pageleave`                  | Boolean or String                        | `'if_capture_pageview'`     |
| `capture_dead_clicks`                | Boolean or `DeadClicksAutoCaptureConfig` | `undefined`                 |
| `capture_exceptions`                 | Boolean or `ExceptionAutoCaptureConfig`  | `undefined`                 |
| `capture_heatmaps`                   | Boolean or `HeatmapConfig`               | `undefined`                 |
| `capture_performance`                | Boolean or `PerformanceCaptureConfig`    | `undefined`                 |
| `cross_subdomain_cookie`             | Boolean                                  | `true`                      |
| `cookieWinsOnConflict`               | Boolean                                  | `false`                     |
| `cookie_expiration`                  | Number                                   | `365`                       |
| `cookieless_mode`                    | `always` or `on_reject`                  | `undefined`                 |
| `custom_blocked_useragents`          | Array                                    | `[]`                        |
| `defaults`                           | String                                   | `unset`                     |
| `debug`                              | Boolean                                  | `false`                     |
| `disable_persistence`                | Boolean                                  | `false`                     |
| `disable_beacon`                     | Boolean                                  | `false`                     |
| `disable_surveys`                    | Boolean                                  | `false`                     |
| `disable_session_recording`          | Boolean                                  | `false`                     |
| `enable_recording_console_log`       | Boolean                                  | `undefined`                 |
| `error_tracking`                     | Object                                   | `{}`                        |
| `evaluation_contexts`                | Array of strings                         | `undefined`                 |
| `flag_keys`                          | Array of strings                         | `undefined`                 |
| `external_scripts_inject_target`     | `'body'` or `'head'`                     | `'body'`                    |
| `strict_script_versioning`           | Boolean or String                        | `'fallback'`                |
| `asset_host`                         | String or null                           | `null`                      |
| `flags_api_host`                     | String                                   | `null`                      |
| `rewriteRequestPath`                 | `(url: URL) => URL`                      | `undefined`                 |
| `tracing_headers`                    | Array of strings                         | `undefined`                 |
| `loaded`                             | Function                                 | `function () {}`            |
| `mask_all_text`                      | Boolean                                  | `false`                     |
| `mask_all_element_attributes`        | Boolean                                  | `false`                     |
| `opt_out_capturing_by_default`       | Boolean                                  | `false`                     |
| `opt_out_capturing_persistence_type` | `localStorage` or `cookie`               | `localStorage`              |
| `opt_out_persistence_by_default`     | Boolean                                  | `false`                     |
| `opt_out_useragent_filter`           | Boolean                                  | `false`                     |
| `respect_dnt`                        | Boolean                                  | `false`                     |
| `persistence`                        | String                                   | `localStorage+cookie`       |
| `persistence_save_debounce_ms`       | Number                                   | `0`                         |
| `split_storage`                      | Boolean                                  | `false`                     |
| `detect_google_search_app`           | Boolean                                  | `false`                     |
| `property_denylist`                  | Array                                    | `[]`                        |
| `person_profiles`                    | `always`, `identified_only`, or `never`  | `identified_only`           |
| `reuseAnonymousId`                   | Boolean                                  | `false`                     |
| `rate_limiting`                      | Object                                   | `{ events_per_second: 10 }` |
| `logs`                               | Object                                   | `undefined`                 |
| `metrics`                            | Object                                   | `undefined`                 |
| `session_recording`                  | Object                                   | `{}`                        |
| `session_idle_timeout_seconds`       | Integer                                  | `1800`                      |
| `surveys`                            | Object                                   | `undefined`                 |
| `request_headers`                    | Object                                   | `{}`                        |
| `rageclick`                          | Boolean or `RageclickConfig`             | `true`                      |

What each option does:

- **`api_host`.** The URL of your PostHog instance.
- **`ui_host`.** If you use a [reverse proxy](https://posthog.com/docs/advanced/proxy) for `api_host`, set this to the actual PostHog app URL, for example `https://us.posthog.com`. Links to PostHog then point to the correct host.
- **`autocapture`.** Whether PostHog [autocaptures](https://posthog.com/docs/product-analytics/autocapture) events. It doesn't affect pageview events (see `capture_pageview`). For the object form, see [Configure autocapture](#configure-autocapture).
- **`before_send`.** A function that amends or rejects events before they're sent to PostHog. See [Amend events before sending](#amend-events-before-sending).
- **`bootstrap`.** Seeds identity (`distinctID`, `isIdentifiedID`), session (`sessionID`), and feature flag state (`featureFlags`, `featureFlagPayloads`) during initialization. See [SDK bootstrapping](https://posthog.com/docs/libraries/bootstrapping).
- **`capture_pageview`.** Whether PostHog captures pageview events automatically. By default it captures them on page load. With the string `history_change`, PostHog captures pageviews on path changes by listening to the browser's history API, which suits single-page apps. `history_change` is the default when you set `defaults: '2025-05-24'` or later.
- **`capture_pageleave`.** Whether PostHog captures pageleave events automatically. With `true`, it captures them on all pages. With `'if_capture_pageview'`, it captures them only when `capture_pageview` is enabled.
- **`capture_dead_clicks`.** Whether PostHog captures dead click events automatically. See [dead clicks autocapture](https://posthog.com/docs/product-analytics/autocapture#dead-clicks-autocapture) for configuration details.
- **`capture_exceptions`.** Whether PostHog captures exceptions automatically for [error tracking](https://posthog.com/docs/error-tracking). When `undefined`, PostHog uses the remote configuration from your project settings.
- **`capture_heatmaps`.** Whether PostHog captures [heatmap](https://posthog.com/docs/toolbar/heatmaps) data. When `undefined`, PostHog uses the remote configuration from your project settings. It replaces the deprecated `enable_heatmaps` option.
- **`capture_performance`.** Whether PostHog captures performance metrics. These are network timing, which session replay uses, and [web vitals](https://posthog.com/docs/web-analytics/web-vitals). When `undefined`, PostHog uses the remote configuration from your project settings. With `false`, it captures neither.
- **`cross_subdomain_cookie`.** Whether PostHog sets the cookie on the top-level domain (`example.com`). If `posthog-js` loads on a subdomain (`test.example.com`) and this option is `false`, PostHog sets the cookie on the subdomain only.
- **`cookieWinsOnConflict`.** With `localStorage+cookie` persistence, makes shared cookie values win over stale per-origin `localStorage` values. The default is `true` when `defaults` is `'2026-08-29'` or later. See [Sync identity across subdomains](#sync-identity-across-subdomains).
- **`cookie_expiration`.** The number of days to store cookies for.
- **`cookieless_mode`.** Enables cookieless tracking. PostHog sets no cookies and uses no session or local storage. A privacy-preserving hash generated on PostHog's servers handles user identity. Use `always` to enable it immediately on startup, with no cookie banner needed. Use `on_reject` to enable it only when a user rejects cookies. You must also enable cookieless mode in your PostHog project settings. If you don't, PostHog ignores cookieless events.
- **`custom_blocked_useragents`.** A list of user agents to block when sending events. See [Block bad actors](#block-bad-actors).
- **`defaults`.** Configuration defaults for breaking changes. See [The defaults option](#the-defaults-option).
- **`debug`.** Enables debug mode with more detailed console logging. See [Use debug mode](#use-debug-mode).
- **`disable_persistence`.** Stops PostHog from persisting user data across pages. This disables cookies, session storage, and local storage.
- **`disable_beacon`.** Stops PostHog from using the browser `navigator.sendBeacon` API to send events. It replaces the deprecated `__preview_disable_beacon` option. It can reduce `$pageleave` delivery reliability.
- **`disable_surveys`.** Whether the surveys script loads. This controls whether surveys show up for users, and whether requests for API surveys return valid data.
- **`disable_session_recording`.** Whether users are opted out of session recording.
- **`enable_recording_console_log`.** Whether PostHog records console logs as part of the session recording. When `undefined`, PostHog uses the remote configuration from your project settings. See [console logs recording](https://posthog.com/docs/session-replay/manual#console-logs-recording).
- **`error_tracking`.** [Error tracking](https://posthog.com/docs/error-tracking) options, such as suppression rules that filter out unwanted exceptions. See `ErrorTrackingOptions` in the `PostHogConfig` type.
- **`evaluation_contexts`.** Evaluation context tags that limit which feature flags PostHog evaluates. When set, PostHog returns only flags with matching evaluation contexts, or with no evaluation contexts. This reduces unnecessary flag evaluations. See the [evaluation contexts docs](https://posthog.com/docs/feature-flags/evaluation-contexts). Available from 1.331.0. The legacy `evaluation_environments` option, from 1.269.0, still works.
- **`flag_keys`.** The feature flag keys to include in this SDK instance's `/flags` requests. See [Evaluate specific flags](#evaluate-specific-flags).
- **`external_scripts_inject_target`.** Where PostHog injects external dependency scripts, such as session recording and surveys, in the DOM. Use `'head'` to avoid SSR hydration errors with frameworks like Next.js, TanStack Router, or other React-based SSR setups. `'body'` keeps the legacy behavior. The default is `'head'` when `defaults` is `'2026-01-30'` or later. This addresses [hydration errors](https://github.com/PostHog/posthog-js/issues/2781) that can occur when PostHog modifies the DOM before the framework completes hydration.
- **`strict_script_versioning`.** How PostHog loads external dependency scripts. With `true`, it uses only versioned asset paths, such as `/static/1.370.0/recorder.js`. With `false`, it uses only legacy query-string URLs, such as `/static/recorder.js?v=1.370.0`. With `'fallback'`, it tries the versioned path first and retries with the legacy path if that fails. See [Version external scripts](#version-external-scripts).
- **`asset_host`.** A host override for the static assets PostHog loads, such as `recorder.js`, `surveys.js`, or `toolbar.js`. It applies only to `/static/*` assets.
- **`flags_api_host`.** A separate reverse proxy host for feature flag requests. If set, all feature flag evaluation requests use this host instead of `api_host`. You need your own [reverse proxy](https://posthog.com/docs/advanced/proxy). It separates feature flags from analytics, which can stop ad blockers from blocking feature flags. See [preventing feature flags from being blocked](https://posthog.com/tutorials/flags-adblock-prevention).
- **`rewriteRequestPath`.** Rewrites fully resolved PostHog API, Feature Flags, remote config, and asset request URLs. See [Customize proxy request paths](#customize-proxy-request-paths).
- **`tracing_headers`.** Hostnames for which PostHog adds tracing headers to `fetch` and `XMLHttpRequest` calls. See [Add tracing headers](#add-tracing-headers).
- **`loaded`.** A function PostHog calls once its scripts load successfully.
- **`mask_all_text`.** Stops PostHog autocapture from capturing any text from your elements.
- **`mask_all_element_attributes`.** Stops PostHog autocapture from capturing any attributes from your elements.
- **`opt_out_capturing_by_default`.** Whether users are opted out of PostHog tracking by default. You then opt them in by calling `posthog.opt_in_capturing`.
- **`opt_out_capturing_persistence_type`.** Where PostHog stores consent decisions, separately from analytics `persistence`. Use `cookie` to share consent across sibling subdomains when `cross_subdomain_cookie` is enabled, which is the default. See [share consent across subdomains](https://posthog.com/docs/privacy/data-collection#share-consent-across-subdomains).
- **`opt_out_persistence_by_default`.** Whether users are opted out of browser data storage by this PostHog instance by default. You then opt them in by calling `posthog.opt_in_capturing`.
- **`opt_out_useragent_filter`.** Whether to turn off user agent filtering, such as for Googlebot or other bots. By default PostHog doesn't send events that match this filter. With `true`, PostHog sets `$browser_type` to either `bot` or `browser` instead of dropping those events.
- **`respect_dnt`.** Whether PostHog respects the browser's Do Not Track setting when it computes consent. With `true`, users with Do Not Track enabled are treated as opted out. The DNT signal is deprecated and not all modern browsers send it, so treat this as best effort, not a compliance guarantee.
- **`persistence`.** How PostHog stores information about the user. The values are `localStorage`, `sessionStorage`, `cookie`, `memory`, and `localStorage+cookie`. See [Choose a persistence mode](#choose-a-persistence-mode).
- **`persistence_save_debounce_ms`.** Debounces rapid persistence writes to `localStorage` or cookies. In-memory state updates immediately, and pending writes flush on page unload. The default is `250` when `defaults` is `'2026-05-30'` or later.
- **`split_storage`.** Stores large feature flag and survey payloads in separate `localStorage` entries instead of the main persistence blob. It applies to `localStorage` and `localStorage+cookie` persistence. The default is `true` when `defaults` is `'2026-05-30'` or later.
- **`detect_google_search_app`.** Detects Google Search App webviews as `$browser: 'Google Search App'` instead of attributing them to Mobile Safari or Chrome. The default is `true` when `defaults` is `'2026-05-30'` or later.
- **`property_denylist`.** A list of properties that PostHog never sends with `capture` calls.
- **`person_profiles`.** Whether events capture identified events and process person profiles. See [The two event types](#the-two-event-types).
- **`reuseAnonymousId`.** With `true`, `identify()` doesn't send the previous anonymous ID as `$anon_distinct_id`. Events captured before `identify()` then aren't merged into the identified person. This helps with `memory` or `sessionStorage` persistence when your app already has a stable user ID.
- **`rate_limiting`.** Controls event rate limiting, so you don't send too many events by accident. `events_per_second` sets how many events PostHog sends per second on average. The default is 10. `events_burst_limit` sets the maximum number of events PostHog sends at once. The default is 10 times the `events_per_second` value.
- **`logs`.** Options for browser logs. See [Configure logs](#configure-logs).
- **`metrics`.** Options for the `posthog.metrics` API. See [Configure metrics](#configure-metrics).
- **`session_recording`.** Options for recordings. See the [session replay configuration docs](https://posthog.com/docs/session-replay/manual). When `defaults` is `'2025-11-30'` or later, `strictMinimumDuration` is enabled by default. It checks the minimum duration against actual buffer data instead of session duration.
- **`session_idle_timeout_seconds`.** The maximum time a session can be inactive before PostHog splits it into a new session.
- **`surveys`.** [Survey](https://posthog.com/docs/surveys) options: `prefillFromUrl` (prefill responses from URL parameters), `autoSubmitIfComplete`, and `autoSubmitDelay`.
- **`request_headers`.** Extra headers to pass with requests to the PostHog API. It replaces the deprecated `xhr_headers` option.
- **`rageclick`.** Whether PostHog captures rage click events when users rapidly click on non-responsive elements. When `defaults` is `'2025-11-30'` or later, `content_ignorelist` is enabled by default, to ignore elements with navigation-related text. See [Configure rage clicks](#configure-rage-clicks).

## Customize proxy request paths

Use `rewriteRequestPath` when your reverse proxy exposes paths that differ from the standard PostHog paths. This option needs `posthog-js` 1.416.0 or later.

The function receives a fully resolved `URL` after the SDK selects `api_host`, `flags_api_host`, or the asset host. If a host setting includes a path, such as `api_host: '/ingest'`, `url.pathname` includes that prefix. Mutate this object or return a new `URL`.

```js
const pathRewrites = [
    ['/i/v0/e/', '/a1/'],
    ['/e/', '/a2/'],
    ['/s/', '/a3/'],
    ['/flags/', '/a4/'],
    ['/array/', '/a5/'],
    ['/static/', '/a6/'],
]

posthog.init('<ph_project_token>', {
    api_host: 'https://e.yourdomain.com',
    ui_host: 'https://us.posthog.com', // Use https://eu.posthog.com for EU projects.
    rewriteRequestPath: (url) => {
        const rewrite = pathRewrites.find(([posthogPath]) => url.pathname.startsWith(posthogPath))

        if (rewrite) {
            const [posthogPath, proxyPath] = rewrite
            url.pathname = proxyPath + url.pathname.slice(posthogPath.length)
        }

        return url
    },
})
```

This example rewrites event API, Session Replay ingestion, Feature Flags, remote config, and static asset paths. Other PostHog API paths keep their standard path on `api_host`. The function changes only `url.pathname`, so each URL keeps its resolved origin and query parameters.

Configure your proxy to reverse every mapping:

| Browser path | PostHog path | PostHog upstream |
| ------------ | ------------ | ---------------- |
| `/a1/*`      | `/i/v0/e/*`  | API host         |
| `/a2/*`      | `/e/*`       | API host         |
| `/a3/*`      | `/s/*`       | API host         |
| `/a4/*`      | `/flags/*`   | API host         |
| `/a5/*`      | `/array/*`   | Asset host       |
| `/a6/*`      | `/static/*`  | Asset host       |

The proxy routes must preserve query parameters and match every path that the function returns. See the [proxy reference](https://posthog.com/docs/advanced/proxy/proxy-reference) for upstream hosts and other requirements.

`rewriteRequestPath` doesn't replace `api_host`, `flags_api_host`, `asset_host`, or `ui_host`. The SDK doesn't apply it to PostHog UI links.

## Add tracing headers

Use `tracing_headers` to add PostHog session and distinct ID headers to the browser requests you send to your backend. Server-side SDKs can then link backend events, logs, errors, and LLM traces back to frontend sessions and replays.

```js
posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    tracing_headers: ['api.example.com'],
})
```

Use hostnames only, for example `api.example.com` or `localhost`. Don't use full URLs with protocols, paths, ports, or wildcard subdomains. Matching `fetch` and `XMLHttpRequest` calls include `X-POSTHOG-DISTINCT-ID` and `X-POSTHOG-SESSION-ID`.

This option needs `posthog-js` 1.380.0 or later. In earlier versions, it was named `__add_tracing_headers`. `addTracingHeaders` and `__add_tracing_headers` are deprecated aliases.

`posthog-js` doesn't create spans. To link backend traces to browser sessions, set `tracing_headers`. To send spans from the server, see the [Node.js SDK reference](https://posthog.com/docs/libraries/node/reference) or [Python](https://posthog.com/docs/distributed-tracing/installation/python).

## Configure autocapture

The `autocapture` option takes an object that gives you full control of autocapture's behavior.

| Option                         | Type                       | Default     |
| ------------------------------ | -------------------------- | ----------- |
| `url_allowlist`                | Array of strings or RegExp | `undefined` |
| `dom_event_allowlist`          | Array of strings           | `undefined` |
| `element_allowlist`            | Array of strings           | `undefined` |
| `css_selector_allowlist`       | Array of strings           | `undefined` |
| `css_selector_ignorelist`      | Array of strings           | `undefined` |
| `element_attribute_ignorelist` | Array of strings           | `undefined` |
| `capture_copied_text`          | Boolean                    | `false`     |

- **`url_allowlist`.** The URLs to enable autocapture on. Entries can be string or regex matches, for example `['https://example.com', 'test.com/.*']`. An empty list allows no URLs. `undefined` allows all URLs.
- **`dom_event_allowlist`.** The DOM events to enable autocapture on, like `click`, `change`, and `submit`. An empty array enables no events. `undefined` enables all events.
- **`element_allowlist`.** The DOM elements to allow autocapture on, like `a`, `button`, `form`, `input`, `select`, `textarea`, or `label`. An empty array enables no elements. `undefined` enables all elements.
- **`css_selector_allowlist`.** The CSS selectors to enable autocapture on. An empty array allows no CSS selectors. `undefined` allows all CSS selectors.
- **`css_selector_ignorelist`.** The CSS selectors to ignore autocapture on. If unset, PostHog ignores `.ph-no-autocapture` and `[data-ph-no-autocapture]`. An empty array ignores nothing. Any custom list replaces the defaults, so include them in your list if you still want them.
- **`element_attribute_ignorelist`.** The element attributes that autocapture doesn't capture. With an empty array or `undefined`, autocapture captures any of the element's attributes.
- **`capture_copied_text`.** With `true`, autocapture captures the text of any element that is cut or copied.

## Configure rage clicks

The `.ph-no-rageclick` class excludes an element from rage click tracking.

If you need more control, the `rageclick` option takes an object that controls rage click detection.

| Option                    | Type                        | Default     |
| ------------------------- | --------------------------- | ----------- |
| `css_selector_ignorelist` | Array of strings            | `undefined` |
| `content_ignorelist`      | Boolean or array of strings | See below   |
| `ignore_text_selection`   | Boolean                     | `false`     |
| `threshold_px`            | Number                      | `30`        |
| `click_count`             | Number                      | `3`         |
| `timeout_ms`              | Number                      | `1000`      |

- **`css_selector_ignorelist`.** The CSS selectors to ignore rage clicks on, for example `['.carousel-button', '.next-button']`. Elements that match these selectors, or their parents, don't trigger rage click events. An empty array disables rage click events altogether. Any value overrides the defaults, so PostHog ignores only the selectors in your array.
- **`content_ignorelist`.** Excludes elements from rage click tracking based on their text content or aria-label. The default is `true` when `defaults` is `'2025-11-30'` or later. With `true`, PostHog uses the default keywords `['next', 'previous', 'prev', '>', '<']`. With `defaults: '2026-05-30'` or later, the default list also excludes `+`, `-`, `−`, and `–`, and PostHog ignores text-selection surfaces. With an array of strings (10 items at most), PostHog uses your keywords. Set it to `false` to disable content-based exclusion. It prevents false positives on navigation elements.
- **`ignore_text_selection`.** Excludes text-editing surfaces from rage click detection. These are textareas, text-like inputs, and `contenteditable` elements. Rapid repeated clicks there are usually double-click or triple-click text selection, not rage. The default is `true` when `defaults` is `'2026-05-30'` or later.
- **`threshold_px`.** The maximum pixel distance between consecutive clicks for them to still count toward a rage click.
- **`click_count`.** The number of consecutive clicks within the timeout that trigger a rage click.
- **`timeout_ms`.** The maximum time, in milliseconds, between consecutive clicks.

## Configure logs

The `logs` option controls how PostHog captures browser log records and sends them with OpenTelemetry. You can send structured records with `posthog.logger` (or `posthog.captureLog` for full control), autocapture `console.*` calls, or both. See the [JavaScript web logs installation guide](https://posthog.com/docs/logs/installation/javascript) for a walkthrough.

| Option               | Type    | Default             |
| -------------------- | ------- | ------------------- |
| `captureConsoleLogs` | Boolean | `undefined`         |
| `serviceName`        | String  | `'unknown_service'` |
| `environment`        | String  | `undefined`         |
| `serviceVersion`     | String  | `undefined`         |
| `resourceAttributes` | Object  | `undefined`         |
| `flushIntervalMs`    | Number  | `3000`              |
| `maxBufferSize`      | Number  | `100`               |
| `maxLogsPerInterval` | Number  | `1000`              |

- **`captureConsoleLogs`.** When enabled, PostHog captures `console.log`, `console.warn`, `console.error`, and the other console methods, and sends them as structured log records. It takes effect from `init()`, including calls made before the logs script finishes loading. It's independent of the **Capture console logs** project setting. Either one enables capture, and the project setting doesn't switch this option off. Review your app's console output before you enable it. Overriding `console` can forward passwords, tokens, or user input that your code or third-party libraries write to the console.
- **`serviceName`.** The service name applied to all log records. It maps to the [OpenTelemetry resource attribute](https://opentelemetry.io/docs/specs/semconv/resource/) `service.name`. Set it to tell apart records from different frontend apps or environments in PostHog.
- **`environment`.** The deployment environment, for example `'production'` or `'staging'`. It maps to the OpenTelemetry resource attribute `deployment.environment`.
- **`serviceVersion`.** The release version, for example `'1.2.3'`. It maps to the OpenTelemetry resource attribute `service.version`.
- **`resourceAttributes`.** More OpenTelemetry resource attributes applied to every record, for example `{ 'host.name': 'web-01' }`. PostHog applies the named fields above first, and you can override them here.
- **`flushIntervalMs`.** How often PostHog flushes batched log records, in milliseconds.
- **`maxBufferSize`.** The buffer size that forces a flush.
- **`maxLogsPerInterval`.** The rate limit per flush window. PostHog drops excess records with a single warning. This protects against runaway loggers flooding the network.

For example:

```js
posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    logs: {
        serviceName: 'checkout-web',
        environment: 'production',
        serviceVersion: '1.2.3',
    },
})
```

## Configure metrics

The `metrics` option controls the `posthog.metrics` API (`count`, `gauge`, and `histogram`) and optional automatic network timing. It needs `posthog-js` 1.399.0 or later. See the [JavaScript web metrics installation guide](https://posthog.com/docs/metrics/installation/javascript) for a walkthrough.

| Option               | Type                           | Default             |
| -------------------- | ------------------------------ | ------------------- |
| `serviceName`        | String                         | `'unknown_service'` |
| `environment`        | String                         | `undefined`         |
| `serviceVersion`     | String                         | `undefined`         |
| `resourceAttributes` | Object                         | `undefined`         |
| `flushIntervalMs`    | Number                         | `10000`             |
| `maxSeriesPerFlush`  | Number                         | `1000`              |
| `beforeSend`         | Function or array of functions | `undefined`         |
| `network`            | Boolean or object              | `undefined`         |

- **`serviceName`.** Sent as the `service.name` resource attribute.
- **`environment`.** Sent as `deployment.environment`.
- **`serviceVersion`.** Sent as `service.version`.
- **`resourceAttributes`.** Extra resource attributes attached to every batch. They take precedence over the named fields above.
- **`flushIntervalMs`.** How often PostHog flushes the aggregated window, in milliseconds.
- **`maxSeriesPerFlush`.** The maximum number of distinct series per window. PostHog drops samples for series beyond the cap with one warning.
- **`beforeSend`.** Edits or drops each sample before it's aggregated. Return `null` to drop a sample.
- **`network`.** Records the duration of every HTTP or HTTPS `fetch` and `XMLHttpRequest` as a histogram. `true` uses the defaults. PostHog doesn't record requests to PostHog itself.

For network timing, set `metrics.network` to `true`, or pass an object with these options:

| Option       | Type               | Default                          |
| ------------ | ------------------ | -------------------------------- |
| `name`       | String or function | `'http.client.request.duration'` |
| `attributes` | Function           | `undefined`                      |

- **`name`.** The metric name. PostHog calls a function once per request with `{ url, method }`. Return a falsy value to skip that request.
- **`attributes`.** PostHog calls it with the request and the response (`{ status, durationMs }`). It merges the result over the default attributes, so you can replace them.

The default attributes follow the OpenTelemetry HTTP client conventions: `http.request.method`, `server.address`, `server.port`, `url.scheme`, `url.template`, `http.response.status_code`, and `error.type`. The default `url.template` replaces each all-digit or UUID-like path segment with `:id`. It keeps IDs with a prefix or suffix, such as `order-123` or `38217.pdf`, as they are. For those routes, return your own `url.template` from `attributes`. Keep attribute values low-cardinality.

```js
posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    metrics: {
        serviceName: 'storefront-web',
        network: {
            attributes: (request) =>
                request.url.includes('/dashboards/') ? { 'url.template': '/dashboards/:slug' } : undefined,
        },
    },
})
```

`metrics.histogram()` also accepts a `bounds` option for the bucket boundaries, from `posthog-js` 1.447.0.

## Combine init and settings

You can turn some features on in `posthog.init` and in your project settings. Which one wins depends on the feature. The SDK reads project settings from the remote config it fetches when it loads.

| Feature               | Init option                      | Rule                |
| --------------------- | -------------------------------- | ------------------- |
| Exception autocapture | `capture_exceptions`             | Init wins when set  |
| Heatmaps              | `capture_heatmaps`               | Init wins when set  |
| Web vitals            | `capture_performance.web_vitals` | Init wins when set  |
| Session replay        | `disable_session_recording`      | Both must allow it  |
| Autocapture           | `autocapture`                    | Either turns it off |
| Console logs          | `logs.captureConsoleLogs`        | Either turns it on  |

- **Exception autocapture.** The init option wins when you set it to `true`, `false`, or an object. When you leave it `undefined`, the project setting decides.
- **Heatmaps.** The init option, `capture_heatmaps` or `enable_heatmaps`, wins when you set it, including `false`. When you leave it unset, the project setting decides.
- **Web vitals.** The init option, `capture_performance.web_vitals` or `capture_performance: true/false`, wins when it's a boolean. Otherwise the project setting decides.
- **Session replay.** Recording runs only when the project setting is on and `disable_session_recording` isn't `true`.
- **Autocapture.** Autocapture runs only when neither the init option nor the project setting disables it.
- **Console logs.** The project setting doesn't switch the init option off.

A new project has replay, exception autocapture, heatmaps, and web vitals off in project settings. The init option is enough for exception autocapture, heatmaps, and web vitals. Session replay needs the project setting on as well.

## Use advanced options

These options are for advanced users. Review them carefully, because they can have unintended side effects.

| Option                                         | Type     | Default       |
| ---------------------------------------------- | -------- | ------------- |
| `advanced_disable_flags`                       | Boolean  | `false`       |
| `advanced_disable_decide`                      | Boolean  | `false`       |
| `advanced_disable_feature_flags`               | Boolean  | `false`       |
| `advanced_disable_feature_flags_on_first_load` | Boolean  | `false`       |
| `advanced_only_evaluate_survey_feature_flags`  | Boolean  | `false`       |
| `advanced_feature_flags_dedup_per_session`     | Boolean  | `false`       |
| `feature_flag_request_timeout_ms`              | Integer  | `3000`        |
| `feature_flag_cache_ttl_ms`                    | Integer  | `0`           |
| `remote_config_refresh_interval_ms`            | Integer  | `300000`      |
| `secure_cookie`                                | Boolean  | See below     |
| `custom_campaign_params`                       | Array    | `[]`          |
| `fetch_options.cache`                          | String   | `undefined`   |
| `fetch_options.next_options`                   | Object   | `undefined`   |
| `on_request_error`                             | Function | Logs an error |

- **`advanced_disable_flags`.** Disables the `/flags` endpoint request completely, and the features that rely on it. See [Disable the flags endpoint](#disable-the-flags-endpoint).
- **`advanced_disable_decide`.** Legacy. It behaves like `advanced_disable_flags`, and it's deprecated. Use `advanced_disable_flags`.
- **`advanced_disable_feature_flags`.** Keeps `/flags` running, but without any feature flag requests. Don't use it if you use surveys, because display conditions rely on feature flags internally.
- **`advanced_disable_feature_flags_on_first_load`.** Stops feature flag requests on first page load. PostHog then requests feature flags only when user identity or properties are updated, or when you manually request flags.
- **`advanced_only_evaluate_survey_feature_flags`.** Whether PostHog evaluates feature flags only for surveys. Use it when you evaluate your other feature flags on the server side.
- **`advanced_feature_flags_dedup_per_session`.** Scopes `$feature_flag_called` deduplication to the current session instead of per identity. It helps [experiments](https://posthog.com/docs/experiments) where a flag was evaluated before the experiment launched. Without it, returning users don't generate new [exposures](https://posthog.com/docs/experiments/exposures). Mobile SDKs already deduplicate per session by default.
- **`feature_flag_request_timeout_ms`.** The timeout for fetching feature flags.
- **`feature_flag_cache_ttl_ms`.** A time-to-live for cached feature flag values. When enabled, `getFeatureFlag()` returns `undefined` instead of stale cached values if the cache is older than the TTL, and PostHog doesn't attach stale `$feature/` properties to events. It helps when `/flags` requests fail, for example because of ad blockers or network issues, and you don't want to use outdated flag values indefinitely. With `0` or `undefined`, the default, cached values never expire.
- **`remote_config_refresh_interval_ms`.** How often PostHog refreshes feature flags and remote config in long-running sessions. The default is 5 minutes. Shorter intervals mean fresher flags but more network requests. Longer intervals reduce traffic, but flag changes propagate more slowly. Set it to `0` to disable periodic refresh. Flags then update only on page load or when you call `posthog.reloadFeatureFlags()`.
- **`secure_cookie`.** With `true`, PostHog marks its cookies as secure, so the browser sends them only over HTTPS. The default is `true` on HTTPS pages and `false` otherwise.
- **`custom_campaign_params`.** A list of query params to capture automatically. See [UTM segmentation](https://posthog.com/docs/data/utm-segmentation).
- **`fetch_options.cache`.** The `fetch` call cache behavior. See the [MDN docs](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#cache) for the available options. It matters with Next.js. See the [Next.js docs](https://nextjs.org/docs/app/api-reference/functions/fetch#fetchurl-options). This option is tricky. Avoid it unless you know the changes it can cause, such as cached feature flag values.
- **`fetch_options.next_options`.** The arguments passed to the `next` key when PostHog calls `fetch` under Next.js. See the [Next.js docs](https://nextjs.org/docs/app/api-reference/functions/fetch#optionsnextrevalidate).
- **`on_request_error`.** PostHog calls it when a PostHog request fails with an HTTP status code of 400 or higher. The callback receives a `RequestResponse` object with the `statusCode`, `text`, and `json` (if available). The default is `logger.error('Bad HTTP status: ' + res.statusCode + ' ' + res.text)`.

## Disable the flags endpoint

One of the first things PostHog does after it initializes is request [the `/flags` endpoint](https://posthog.com/docs/api/flags) on PostHog's backend. This endpoint returns information on how to run the PostHog library, so the backend receives events properly. Most features of the library need it.

If you use none of these features, you can turn the call off. This avoids an extra request and reduces resource usage on the client and the server.

To disable the `/flags` endpoint, set `advanced_disable_flags` to `true`.

> **Note.** This option was introduced in `posthog-js` 1.10.0. Before that, disabling autocapture also disabled the `/flags` endpoint. That turned off session recording, feature flags, compression, and the toolbar too.

> **Warning.** These features are fully disabled when the `/flags` endpoint is disabled.

- **Autocapture.** The `/flags` endpoint says whether autocapture is enabled, apart from local configuration.
- **Session recording.** The endpoint says where to send session recording events.
- **Compression.** The endpoint says which compression methods the backend supports for event payloads, for example LZ64 and gzip.
- **Feature flags.** The endpoint returns the feature flags enabled for the current person.
- **Surveys.** The endpoint says whether surveys are enabled.
- **Toolbar.** The endpoint returns the authentication information and other toolbar capabilities that the toolbar needs.

Custom event captures (`posthog.capture`), `$identify`, `$set`, `$set_once`, and any other calls not listed above work as expected when `/flags` is disabled.

## Choose a persistence mode

PostHog stores a small amount of information about the user in the user's browser. This lets PostHog identify users properly when they leave your site and come back later.

The stored information includes:

- Their `distinct_id`
- Session ID and device ID
- Active and enabled feature flags
- Any super properties you defined
- Some PostHog configuration options, for example whether session recording is enabled

By default, PostHog uses `localStorage+cookie` persistence. It stores the full state in `localStorage` and a smaller identity and session subset in a first-party cookie. PostHog can then identify visitors across sibling subdomains that can access the cookie. The cookie name is `ph_<project_token>_posthog`, and it expires after `365` days.

To change how PostHog stores this information, set the `persistence` option:

- **`persistence: "localStorage+cookie"`** (default). Stores a limited set of values, such as the distinct ID and the session ID, in the cookie. Stores everything else in the browser's [`localStorage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).
- **`persistence: "cookie"`.** Stores all data in a cookie.
- **`persistence: "localStorage"`.** Stores everything in `localStorage`.
- **`persistence: "sessionStorage"`.** Stores everything in `sessionStorage`.
- **`persistence: "memory"`.** Stores everything in page memory, so data persists only for the duration of the page view.

To change `persistence` without reinitializing PostHog, use the `posthog.set_config()` method. You can switch from memory to cookies, which helps you comply with privacy regulations.

```js
const handleCookieConsent = (consent) => {
    posthog.set_config({ persistence: consent === 'yes' ? 'localStorage+cookie' : 'memory' })
    localStorage.setItem('cookie_consent', consent)
}
```

Keep these caveats in mind:

- **Subdomains.** `localStorage` and `sessionStorage` don't work across subdomains. If you have several sites on the same domain, consider a `cookie` option, or set all super properties on each subdomain.
- **Cookie size.** Cookies have a size limit, so you can get `431 Request Header Fields Too Large` errors, for example if you have a lot of feature flags. In that case, use `localStorage+cookie`.
- **Iframes.** Be careful with cookie-based persistence inside iframes. If your app is embedded in an iframe on a different site, the browser treats those cookies as third-party cookies. Many browsers block or partition third-party cookies, so PostHog can't reliably reuse the same `distinct_id` or session across iframe loads. If you need a stable identity in a cross-site iframe, pass an identifier from the parent page to the iframe and call [`posthog.identify`](#link-events-to-users) inside the iframe. Or [bootstrap PostHog with a distinct ID](https://posthog.com/docs/libraries/bootstrapping#bootstrap-an-identity).
- **No storage.** If you don't want PostHog to store anything in the user's browser, set `disable_persistence: true`. You can do this to rely only on your own identification mechanism, or to have completely anonymous users. If your app knows the person's stable ID when PostHog initializes, [bootstrap PostHog with that distinct ID](https://posthog.com/docs/libraries/bootstrapping#bootstrap-an-identity) instead of calling `posthog.identify()` after initialization. Without a stable bootstrapped ID, PostHog creates a new anonymous ID on every page load, and `posthog.identify()` merges each new ID into the identified person. With completely anonymous users, PostHog treats every page refresh as a new and different user.
- **Browser extensions.** Use `localStorage`, `sessionStorage`, or `memory`. Each extension context can initialize its own PostHog instance. These contexts don't share storage, so the instances don't know about each other. PostHog doesn't support the `browser.storage` and `chrome.storage` APIs for persistence. Pass your own shared `distinct_id` at each initialization, so events are sent under the same identifier. See the [browser extension docs](https://posthog.com/docs/advanced/browser-extension).

## Separate analytics and consent

Analytics state and consent decisions use separate storage settings:

- **`persistence`.** Where PostHog stores analytics state, such as identity and session information. The default is `localStorage+cookie`.
- **`opt_out_capturing_persistence_type`.** Where PostHog stores consent decisions. The default is `localStorage`, which is specific to each origin.
- **`cookieWinsOnConflict`.** Whether shared analytics cookie values win conflicts with that origin's `localStorage` values. It doesn't share consent decisions.

Both `localStorage` and PostHog cookies are first-party storage. Their scopes differ. `localStorage` belongs to one origin, and cookies can be shared across sibling subdomains.

A shared analytics identity doesn't mean consent is shared. Neither `persistence: "cookie"` nor `cookieWinsOnConflict: true` changes the consent storage backend. To share one consent decision across subdomains, set `opt_out_capturing_persistence_type: "cookie"` on each. See [share consent across subdomains](https://posthog.com/docs/privacy/data-collection#share-consent-across-subdomains) for an example and for guidance on separate consent decisions.

## Sync identity across subdomains

With `localStorage+cookie`, `localStorage` belongs to one origin. When `cross_subdomain_cookie` is enabled, sibling subdomains share the first-party PostHog cookie. This can cause a conflict when both stores contain the same key. For example:

1. A tab on `www.example.com` stores an anonymous identity in its `localStorage`.
2. Your app calls `posthog.identify()` on `app.example.com` and updates the shared cookie.
3. The first tab stays open, or the visitor returns to `www.example.com`. Its `localStorage` still contains the anonymous identity.

When `cookieWinsOnConflict` is disabled, the stale `localStorage` value wins this conflict. This is the default when `defaults` is unset. The tab can then capture events with the old identity or session. It can also write that old state back to the shared cookie.

Set `cookieWinsOnConflict: true` to make the shared cookie authoritative for the keys it contains:

```js
posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    persistence: 'localStorage+cookie',
    cross_subdomain_cookie: true,
    cookieWinsOnConflict: true,
})
```

This option needs `posthog-js` 1.418.0 or later. It applies only to `localStorage+cookie` persistence. The SDK enables it by default when you set `defaults: '2026-08-29'` or a later defaults snapshot. It stays disabled when `defaults` is unset or earlier than `2026-08-29`. An explicit `cookieWinsOnConflict` value overrides the snapshot default.

When enabled, PostHog synchronizes these cookie-backed values:

- Identity state, including the distinct ID, device ID, and anonymous or identified state
- Session state, including the session ID, last activity time, and session start time
- Session Replay sampling state, person-processing state, and initial-person information
- Properties that you add with `cookie_persisted_properties`

At initialization, cookie values win over matching values in that subdomain's `localStorage`. PostHog then updates `localStorage` with the synchronized state. In an open tab, PostHog checks for shared-cookie changes before captures and persistence writes. So synchronization happens on the tab's next PostHog activity, not immediately when another subdomain changes the cookie.

PostHog can adopt a shared identity during any of these checks. A persistence write can record the adoption without immediately reloading Feature Flags. When PostHog next processes the adopted identity, such as before a capture, it clears identity-bound Feature Flag state and starts a reload. [`onFeatureFlags`](#wait-for-flags) callbacks run after the reload completes.

If the session ID changes, `posthog.onSessionId()` callbacks run when the tab next checks its session, such as during the next capture. A synchronized `reset()` also clears event and session properties that belonged to the previous identity.

This setting synchronizes state only between sibling subdomains that can access the same first-party cookie. It doesn't add tracking between unrelated domains or enable third-party cookies.

If you used the deprecated `__preview_cookie_wins_on_conflict` option, replace it with `cookieWinsOnConflict`.

## Persist properties in cookies

With `localStorage+cookie` persistence, the default, PostHog stores most properties in `localStorage`. Only essential values like `distinct_id` and the session ID go in the cookie. `localStorage` doesn't work across subdomains, but cookies do. Use the `cookie_persisted_properties` option to name more properties that PostHog stores in the cross-subdomain cookie.

`cookie_persisted_properties` controls which extra properties PostHog shares in the cookie. It doesn't resolve conflicts between the cookie and `localStorage`. Use `cookieWinsOnConflict` for that.

This helps when you need specific properties across subdomains. For example, you can track which products a user showed interest in on your marketing site, and use that data to personalize their onboarding on your app subdomain.

```js
posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    persistence: 'localStorage+cookie',
    cookie_persisted_properties: ['user_preferences', 'signup_source'],
})
```

Set these properties with `posthog.register()`:

```js
// Store a property that will persist in the cookie
posthog.register({ signup_source: 'product-page' })

// Later, read it back (works across subdomains)
const source = posthog.get_property('signup_source')
```

This example tracks which products a user viewed on a marketing site, then uses that data for personalized onboarding on an app subdomain:

```js
// On marketing site (e.g., example.com)
posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    persistence: 'localStorage+cookie',
    cookie_persisted_properties: ['product_interests'],
})

// When user visits a product page
function trackProductInterest(productSlug) {
    const currentInterests = posthog.get_property('product_interests') || []
    if (!currentInterests.includes(productSlug)) {
        currentInterests.push(productSlug)
    }
    posthog.register({ product_interests: currentInterests })
}

// On app subdomain (e.g., app.example.com)
// The property is automatically available because it's in the cross-subdomain cookie
const interests = posthog.get_property('product_interests') || []
// interests = ["analytics", "session-replay", ...]
```

> **Warning.** Cookies have a maximum size of about 4KB. If your `cookie_persisted_properties` store large arrays or complex objects, you can exceed this limit. This can cause:
>
> - Properties being silently truncated or not stored
> - `431 Request Header Fields Too Large` errors from your server
> - Unexpected behavior when reading properties
>
> Keep cookie-persisted values small, like short strings and small arrays of IDs. For larger data, consider `localStorage` persistence and a different cross-subdomain strategy, or store the data server-side.

## Pin the snippet version

The HTML snippet loads the SDK from a CDN. By default, it loads from the legacy path `/static/array.js`, which follows the latest 1.x.x release.

Use snippet versioning when you need to control that rollout. For example, you can pin a known-good SDK version while you debug a regression, track the latest release in a specific major version, or guarantee that the SDK script doesn't change until you edit the snippet again.

PostHog SDK releases are designed to be backwards compatible, so pinning isn't about opting into a safer channel. It's for teams that need stricter change control over exactly which script loads.

> **Note.** This applies to the HTML snippet. If you install `posthog-js` from npm, your package manager lockfile controls the SDK version instead. See [keeping SDKs current](https://posthog.com/docs/health-checks/keeping-sdks-current#npm-and-package-manager-lockfiles).

Snippet versioning supports major-version pins and exact-version pins.

| Pin format       | Example path               | Behavior                 |
| ---------------- | -------------------------- | ------------------------ |
| Default (legacy) | `/static/array.js`         | Latest `1.x.x` release   |
| Major            | `/static/1/array.js`       | Latest `1.x.x` release   |
| Exact            | `/static/1.380.0/array.js` | Exactly that SDK version |

The default path is equivalent to `/static/1/array.js`. An exact pin keeps that SDK version until you change the snippet. Minor pins such as `/static/1.380/array.js` aren't supported.

Exact pins suit short-term rollback, debugging, or strict change control. They guarantee the SDK version doesn't change until you update the snippet, but they also stop automatic fixes from reaching your users. Remove exact pins once you no longer need that guarantee.

To pin the snippet version, edit the HTML snippet in your site's code.

1. Find the `/static/array.js` path in your installed PostHog snippet.
2. Change it to a supported versioned path.
3. Deploy the updated snippet.

For example, the generated snippet contains a line like this:

```js
p.src = s.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js'
```

To make the 1.x.x major-version path explicit, change only the path:

```js
p.src = s.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/1/array.js'
```

To guarantee the snippet keeps loading the same SDK until you change it again, use the exact version path:

```js
p.src = s.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/1.380.0/array.js'
```

Keep the rest of the snippet unchanged. To return to the default snippet path, change the path back to `/static/array.js`.

## Version external scripts

`array.js` is only the initial SDK bundle. Some PostHog features load extra scripts when needed, including:

- `recorder.js` for [Session Replay](https://posthog.com/docs/session-replay)
- `surveys.js` for [Surveys](https://posthog.com/docs/surveys)
- `toolbar.js` for the [toolbar](https://posthog.com/docs/toolbar)

By default, these scripts use compatibility URLs like:

```text
/static/recorder.js?v=1.380.0
```

We recommend `strict_script_versioning: true` whenever your CDN or reverse proxy can serve versioned `/static/*` asset paths:

```js
posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    defaults: '<ph_posthog_js_defaults>',
    strict_script_versioning: true,
})
```

This changes dependency URLs to exact version paths like:

```text
/static/1.380.0/recorder.js
```

This recommendation holds whether or not you pin the initial snippet. Feature scripts, such as `recorder.js`, then load from the same SDK version as the loaded `array.js`, instead of relying on query-string cache busting.

## Proxy the SDK assets

Prefer routing `/static/*` through your reverse proxy. This keeps SDK asset requests on your first-party domain, which is the best option for avoiding [ad blockers](https://posthog.com/docs/privacy/ad-blockers). [PostHog's managed reverse proxy](https://posthog.com/docs/advanced/proxy/managed-reverse-proxy) supports this out of the box.

Use `asset_host` only when `/static/*` assets need a separate host from `api_host`. That's the case if you run a custom reverse proxy for PostHog traffic that doesn't route `/static/*` requests. Keep `api_host` pointed at your proxy and point `asset_host` at the correct regional PostHog asset host:

```js
posthog.init('<ph_project_token>', {
    api_host: '<ph_client_api_host>',
    defaults: '<ph_posthog_js_defaults>',
    strict_script_versioning: true,
    asset_host: 'https://us-assets.i.posthog.com', // or 'https://eu-assets.i.posthog.com'
})
```

`asset_host` applies only to `/static/*` assets such as `recorder.js`, `surveys.js`, and `toolbar.js`. It doesn't change event capture, feature flag requests, or the token-specific remote config URL (`/array/<token>/config.js`).

If you use a reverse proxy for `/static/*`, pick a regional asset host to serve requests: `https://us-assets.i.posthog.com` or `https://eu-assets.i.posthog.com`. Both hosts are served through a global CDN with edge caching. It can still be worth choosing the host with the lowest cache-miss latency for your setup. That's usually the one closest to your users or your reverse proxy.

Your reverse proxy should forward all PostHog SDK paths your site can request:

- `/static/array.js`
- `/static/1/array.js` for a major-version snippet pin
- `/static/1.380.0/array.js` for an exact-version snippet pin
- `/static/<version>/<asset>.js` when `strict_script_versioning` is enabled
- `/static/<asset>.js?v=<version>` for compatibility URLs
- `/array/<token>/config.js`
- normal API paths such as `/e`, `/flags`, `/decide`, and `/s`

Avoid caching `/static/array.js` or `/static/1/array.js` for long periods if you want users to pick up new SDK releases quickly. Exact versioned paths like `/static/1.380.0/array.js` and `/static/1.380.0/recorder.js` are immutable, so you can cache them more aggressively.

## Fix snippet version problems

- **The browser still loads an old SDK version.** Inspect the deployed snippet path. `/static/1.380.0/array.js` is an exact pin. `/static/1/array.js` and `/static/array.js` both track the latest 1.x.x release. Also check CDN, service worker, and reverse proxy caches.
- **The snippet returns a 404 after you add a pin.** Check that the path is either a major pin such as `/static/1/array.js` or an exact pin such as `/static/1.380.0/array.js`. Minor pins such as `/static/1.380/array.js` aren't supported.
- **Session Replay, Surveys, or toolbar scripts return a 404.** Your proxy may not forward `/static/<version>/<asset>.js`. Add that route or disable `strict_script_versioning`.
- **`array.js` updates, but feature scripts stay stale.** Enable `strict_script_versioning`, so dependency scripts use versioned paths instead of query-string cache busting.
- **Tag manager installs don't update.** Some tag manager templates pin their own `posthog-js` version. Update the tag manager template separately.
- **You use npm, not the HTML snippet.** Update `posthog-js` through your package manager instead. The snippet path doesn't affect bundled npm installs.

For broader causes of stale SDKs, see [keeping SDKs current](https://posthog.com/docs/health-checks/keeping-sdks-current).

## Install the SDK securely

The SDK runs with the same access to your page as your own application code. Use version controls, Subresource Integrity (SRI), Content Security Policy (CSP), and nonces to control how you load it. These controls protect different boundaries. None of them makes untrusted code safe to run.

If you need to review SDK changes before deployment, follow [Pin the snippet version](#pin-the-snippet-version) for CDN installations, or the [package-manager lockfile guidance](https://posthog.com/docs/health-checks/keeping-sdks-current#npm-and-package-manager-lockfiles) for npm installations. Use an exact dependency version, commit the lockfile, and enforce frozen installs in CI.

Version pins and [versioned feature scripts](#version-external-scripts) select releases. They don't verify the bytes a CDN or proxy returns. `strict_script_versioning` doesn't pin the token-specific `/array/<token>/config.js` script.

Review and deploy updates regularly, so pins don't stop security fixes from reaching your users. See [keeping SDKs current](https://posthog.com/docs/health-checks/keeping-sdks-current).

## Use Subresource Integrity

[Subresource Integrity (SRI)](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) lets the browser check a downloaded script against an expected cryptographic hash before it executes the script. Use it with an exact-version URL, not a moving URL such as `/static/array.js` or `/static/1/array.js`.

Release integrity manifests and the loader's `data-core-integrity` attribute need `posthog-js` [1.445.0 or later](https://github.com/PostHog/posthog-js/releases/tag/posthog-js%401.445.0). Use the release manifest's SHA-384 hashes instead of calculating them manually.

Download the manifest during your dependency approval or deployment process. Replace `<SDK_VERSION>` in all examples with the same exact release you reviewed.

```bash
curl --fail --show-error --silent --location \
  "https://us-assets.i.posthog.com/static/<SDK_VERSION>/integrity.json" \
  --output posthog-integrity.json
```

The manifest's `files` object maps asset filenames to complete SRI values, such as `"array.js": "sha384-..."`. Use `files["array.js"]` for the core SDK and `files["loader.js"]` for the static loader. The npm package also includes its build's manifest at `dist/integrity.json`.

Use the CDN manifest from the regional asset host you serve, because regional toolbar assets can differ. If you use a reverse proxy, it must serve the same approved bytes. Review the release and assets through your normal dependency approval process. Then store the selected hashes in your application source or build artifacts.

A manifest from a compromised server doesn't establish that the code is trustworthy. Don't fetch expected hashes dynamically at page load.

Use this loader instead of the inline snippet. Set `integrity` to `files["loader.js"]` and `data-core-integrity` to `files["array.js"]` from your approved manifest:

```html
<script
    src="https://us-assets.i.posthog.com/static/<SDK_VERSION>/loader.js"
    integrity="sha384-<LOADER_SHA384_BASE64_DIGEST>"
    data-core-integrity="sha384-<ARRAY_SHA384_BASE64_DIGEST>"
    data-project-token="<ph_project_token>"
    crossorigin="anonymous"
></script>
```

If you serve the loader through a reverse proxy, set `data-api-host` to your ingestion URL. Move existing initialization options into `data-config` as JSON. For function-valued options, set `data-defer-init="true"` and call `posthog.init(...)` explicitly.

Replace both complete hash placeholders and the project token. When you upgrade, update the version and both hashes together. If a hash doesn't match, the browser blocks execution. Don't retry without integrity.

Cross-origin SRI needs CORS response headers. PostHog's asset hosts provide them. Preserve them if you use a cross-origin proxy.

These hashes protect only `loader.js` and `array.js`. They don't protect additional scripts such as the recorder, surveys, toolbar, or `config.js`. For controls on optional SDK scripts, see the [`prepare_external_dependency_script` hook](https://posthog.com/docs/advanced/content-security-policy#supporting-nonce-directives). To avoid runtime executable downloads altogether, see [Bundle without external scripts](#bundle-without-external-scripts).

## Configure Content Security Policy

> **If your site sets a Content-Security-Policy**, it needs to allow PostHog. This applies to the snippet and to package installs alike. The SDK lazy-loads extra bundles (session replay, surveys) from PostHog's CDN, and sends events to the ingestion host. PostHog serves from subdomains of `posthog.com` that change over time, so allow the wildcard:
>
> ```
> script-src 'self' https://*.posthog.com;
> connect-src 'self' https://*.posthog.com;
> worker-src 'self' blob: data:;
> ```
>
> `script-src` covers the snippet and the lazy-loaded bundles, `connect-src` covers event ingestion and feature flags, and `worker-src` covers session replay. The [toolbar needs a few more](https://posthog.com/docs/advanced/content-security-policy), or use a [reverse proxy](https://posthog.com/docs/advanced/proxy) so everything is first-party. If you don't allow PostHog, you get silent failures where `capture` and `identify` calls never send, so the integration looks complete while zero events arrive. `connect-src` falls back to `default-src`, so `default-src 'self'` blocks event delivery even when the script itself is bundled.

CSP limits which resources the browser can load and which scripts it can execute. Follow the [CSP directives guide](https://posthog.com/docs/advanced/content-security-policy#content-security-policy-directives-needed) for SDK scripts, API connections, workers, and optional toolbar resources.

Keep `script-src` and `connect-src` separate in your review. Permitting event ingestion doesn't require permitting remote JavaScript. Bundling the SDK doesn't remove the need to permit its API requests. Test the features you enable before you enforce your policy. Use browser console reports to find blocked resources, instead of broadly adding `unsafe-inline` or `unsafe-eval`.

Use [CSP tracking](https://posthog.com/docs/csp-tracking) to test your policy in report-only mode before enforcement, and to monitor violations after deployment.

A [reverse proxy](https://posthog.com/docs/advanced/proxy) changes where requests go. It doesn't verify script contents or reduce the privileges of code running on your page.

## Use nonces

Follow [supporting nonce directives](https://posthog.com/docs/advanced/content-security-policy#supporting-nonce-directives) for SDK configuration. Generate an unpredictable nonce for each HTML response. Authorize the initial installation code and the elements the SDK creates.

Nonces authorize execution. They don't verify script contents or replace SRI.

## Bundle without external scripts

To avoid runtime executable downloads, [install the SDK from npm](#use-other-package-managers) and follow [Bundle all extensions](#bundle-all-extensions) for the no-external import options and feature trade-offs. Installing from npm with the default `posthog-js` import doesn't prevent dependency downloads.

Set `disable_external_dependency_loading: true` at the first initialization of every SDK instance. This blocks the standard SDK script loader, including executable `config.js`. Without preloaded configuration, the SDK requests project configuration as JSON instead. Configuration, flags, and events still use the network. See the [`PostHogConfig` type](https://posthog.com/docs/libraries/js/reference#posthogconfig) for the available controls.

Don't combine this setup with the snippet, tag-manager installations, or another permissively configured SDK copy. No-external builds don't remove a shared loader or renderer that another bundle already registered.

Preventing script downloads doesn't sanitize remote HTML or disable bundled renderers. Review remotely configured UI separately. This setup doesn't isolate the SDK from your page, and it doesn't protect against a compromised package or build pipeline.

## Check your installation

Use only your public project token in browser code, never a [personal API key](https://posthog.com/docs/api/personal-api-keys). Client-side feature flags aren't authorization checks. Enforce access control on your server.

Review [data collection and consent](https://posthog.com/docs/privacy/data-collection) and [session replay masking](https://posthog.com/docs/session-replay/privacy) separately. Capture opt-out settings don't guarantee that there are no network requests or script downloads.

Before deployment and after each upgrade:

- Use a clean browser profile to check the Network panel during initialization, event capture, feature flag evaluation, and optional features.
- Check for duplicate SDK installations, unexpected executable downloads, CSP violations, and integrity failures.
- For the no-external setup, check that JSON configuration, flags, and events work without vendor script downloads. Test without CSP first, then with CSP, so blocked requests don't hide unwanted loading attempts.
- For SRI, test that an incorrect hash blocks execution and that the correct hash loads the SDK. Check any proxy or CDN transformations that could change the bytes.
