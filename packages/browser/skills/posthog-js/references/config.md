# Configuration reference

## Configuration reference

### `AutocaptureConfig`

If an array is passed for an allowlist, autocapture events will only be sent for elements matching
at least one of the elements in the array. Multiple allowlists can be used

#### Extended by

- `AutocaptureConfig`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-capture_copied_text"></a> `capture_copied_text?` | `boolean` | When true, autocapture captures cut, copy, and paste interactions. Paste events do not contain pasted text. |
| <a id="property-capture_value_css_selector_allowlist"></a> `capture_value_css_selector_allowlist?` | `string`[] \| ((`element`) => `boolean`) | CSS selectors or a predicate opting individual native fields into value capture on change events. Selectors match the field itself, not its ancestors. An empty array disables value capture. String values are sent in $input_value and may be edited in before_send. Values are not automatically redacted; only opt in fields whose contents you intend to collect. Password fields, no-capture markers, sensitive-field exclusions, and mask_all_text still apply. **Default** `['[data-ph-capture-value]']` |
| <a id="property-css_selector_allowlist"></a> `css_selector_allowlist?` | `string`[] | List of CSS selectors to allow autocapture on e.g. ['[ph-capture]'] we consider the tree of elements from the root to the target element of the click event so for the tree div > div > button > svg and allow list config `['[id]']` we will capture the click if the click-target or its parents has any id Everything is allowed when there's no allowlist |
| <a id="property-css_selector_ignorelist"></a> `css_selector_ignorelist?` | `string`[] | List of CSS selectors to ignore autocapture on e.g. ['[data-ph-no-autocapture]'] we consider the tree of elements from the root to the target element of the click event so for the tree div > div > button > svg and ignore list config `['[id]']` we will ignore the click if the click-target or its parents has any id Nothing is ignored when there's an empty ignorelist, e.g. [] If no ignorelist is set, we default to ignoring .ph-no-autocapture and [data-ph-no-autocapture] Note: providing any custom list fully replaces the defaults — include .ph-no-autocapture and [data-ph-no-autocapture] explicitly if you still want them honoured. |
| <a id="property-dom_event_allowlist"></a> `dom_event_allowlist?` | `DomAutocaptureEvents`[] | List of DOM events to allow autocapture on e.g. ['click', 'change', 'submit'] |
| <a id="property-element_allowlist"></a> `element_allowlist?` | `AutocaptureCompatibleElement`[] | List of DOM elements to allow autocapture on e.g. ['a', 'button', 'form', 'input', 'select', 'textarea', 'label'] We consider the tree of elements from the root to the target element of the click event so for the tree `div > div > button > svg` if the allowlist has `button` then we allow the capture when the `button` or the `svg` is the click target but not if either of the `div`s are detected as the click target |
| <a id="property-element_attribute_ignorelist"></a> `element_attribute_ignorelist?` | `string`[] | Exclude certain element attributes from autocapture E.g. ['aria-label'] or [data-attr-pii] |
| <a id="property-url_allowlist"></a> `url_allowlist?` | (`string` \| `RegExp`)[] | List of URLs to allow autocapture on, can be strings to match or regexes e.g. ['https://example.com', 'test.com/.*'] this is useful when you want to autocapture on specific pages only if you set both url_allowlist and url_ignorelist, we check the allowlist first and then the ignorelist. the ignorelist can override the allowlist |
| <a id="property-url_ignorelist"></a> `url_ignorelist?` | (`string` \| `RegExp`)[] | List of URLs to not allow autocapture on, can be strings to match or regexes e.g. ['https://example.com', 'test.com/.*'] this is useful when you want to autocapture on most pages but not some specific ones if you set both url_allowlist and url_ignorelist, we check the allowlist first and then the ignorelist. the ignorelist can override the allowlist |

### `BootstrapConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-distinctid"></a> `distinctID?` | `string` \| `null` | Distinct ID to use before the SDK has loaded persisted identity. |
| <a id="property-featureflagpayloads"></a> `featureFlagPayloads?` | `Record`\<`string`, `JsonType`\> \| `null` | Feature flag payloads to use together with bootstrapped `featureFlags`. |
| <a id="property-featureflags"></a> `featureFlags?` | `Record`\<`string`, `string` \| `boolean`\> \| `null` | Feature flag values to use immediately until the SDK fetches fresh values. |
| <a id="property-isidentifiedid"></a> `isIdentifiedID?` | `boolean` \| `null` | Whether `distinctID` already identifies a known person profile. |
| <a id="property-sessionid"></a> `sessionID?` | `string` \| `null` | Optionally provide a sessionID, this is so that you can provide an existing sessionID here to continue a user's session across a domain or device. It MUST be: - unique to this user - a valid UUID v7 - the timestamp part must be <= the timestamp of the first event in the session - the timestamp of the last event in the session must be < the timestamp part + 24 hours |

### `BrowserMetricsConfig`

Metrics configuration options for the browser SDK. Adds the options that
only the browser SDK implements to the shared metrics options.

#### Extends

- `MetricsConfig`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-beforesend"></a> `beforeSend?` | `BeforeSendMetricFn` \| `BeforeSendMetricFn`[] | Pre-aggregation filter for metric samples, as a single function or a left-to-right chain. Each function inspects, mutates, or drops a sample (return `null` to drop) before it is aggregated. | `MetricsConfig`.`beforeSend` |
| <a id="property-environment"></a> `environment?` | `string` | The deployment environment for metric series (e.g. 'production', 'staging'). Maps to the OTel resource attribute 'deployment.environment'. | `MetricsConfig`.`environment` |
| <a id="property-flags"></a> `flags?` | `boolean` | **`Experimental`** EXPERIMENTAL: Record the round trip of every `/flags` HTTP attempt as the histogram `posthog.flags.request.duration`, in milliseconds. Each retry is a separate sample. The timer starts when the SDK hands the request to the transport, so the duration includes compressing the request body. Samples carry the server host, the response status or error type, and the browser's IANA timezone as `client.timezone`. Requests that the SDK drops before they reach the network are not recorded. An attempt that gets a response also splits that duration into three histograms with the same attributes: `posthog.flags.request.pre_send_duration` (until the request starts), `posthog.flags.request.network_duration` (until the last byte of the response arrives, from the request's Resource Timing entry) and `posthog.flags.request.main_thread_duration` (until the SDK's callback runs). The attempt records them only when the browser reports a Resource Timing entry within 5 seconds of the callback that no other `/flags` request from this copy of the SDK to the same URL can own. This option, the metric names, and their attributes may change or be removed in any release. **Default** `undefined @experimental` | - |
| <a id="property-flushintervalms"></a> `flushIntervalMs?` | `number` | How often the aggregated window is flushed, in milliseconds. Samples are folded into per-series aggregates in memory between flushes — one data point per series per window, no matter how many calls. The browser SDK defaults to 60000: every tab of an app writes to the same series, so a longer window keeps busy series under the backend's per-series point limit. **Default** `10000 (60000 in the browser)` | `MetricsConfig`.`flushIntervalMs` |
| <a id="property-maxseriesperflush"></a> `maxSeriesPerFlush?` | `number` | Cardinality guardrail: maximum distinct series (name + type + unit + attribute combination) held per flush window. Samples for series beyond the cap are dropped with a single warning per window. **Default** `1000` | `MetricsConfig`.`maxSeriesPerFlush` |
| <a id="property-network"></a> `network?` | `boolean` \| `NetworkMetricsConfig` | Record the duration of every HTTP or HTTPS `fetch` and `XMLHttpRequest` as a histogram. `true` uses the defaults. Requests to PostHog itself, URLs with other protocols, and server-sent event streams (`text/event-stream` responses) are not recorded. Long-polling requests look like ordinary requests; skip them with a `name` function that returns `null`. Each transport is measured to the boundary its API exposes: a `fetch` to its response headers, an `XMLHttpRequest` to the end of its response body. **Default** `undefined` | - |
| <a id="property-resourceattributes"></a> `resourceAttributes?` | `MetricAttributes` | Additional resource attributes applied to every metrics batch. These describe the service/deployment, not individual series. Named fields (serviceName, environment, serviceVersion) are set first; resourceAttributes can override them. **Example** `{ 'host.name': 'web-01', 'cloud.region': 'us-east-1' }` | `MetricsConfig`.`resourceAttributes` |
| <a id="property-servicename"></a> `serviceName?` | `string` | The service name for metric series. Maps to the OTel resource attribute 'service.name'. **Default** `'unknown_service'` | `MetricsConfig`.`serviceName` |
| <a id="property-serviceversion"></a> `serviceVersion?` | `string` | The service version for metric series (e.g. '1.2.3'). Maps to the OTel resource attribute 'service.version'. | `MetricsConfig`.`serviceVersion` |

### `ConfigDefaults`

> **ConfigDefaults** = `"latest"` \| *typeof* `CONFIG_DEFAULTS_DATES`\[`number`\] \| `"unset"`

Configuration defaults snapshot used by `PostHogConfig.defaults`.
Later dates include all earlier default changes. `latest` includes all changes in the loaded SDK version.

### `ConversationsConfig`

Conversations configuration options

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-theme"></a> `theme?` | `ConversationsTheme` | Theme of the support widget. Change it after init with `posthog.conversations.setTheme()`. **Example** `posthog.init('phc_...', { conversations: { theme: { colorScheme: 'auto', primary: '#111827', dark: { primary: '#f9fafb' } }, }, })` |

### `ConversationsRemoteConfig`

Remote configuration for conversations from the PostHog server.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-collectname"></a> `collectName?` | `boolean` | Whether to show the name field in the identification form. |
| <a id="property-color"></a> `color?` | `string` | Primary color for the widget UI. |
| <a id="property-domains"></a> `domains?` | `string`[] | Domains where the widget may be shown. |
| <a id="property-enabled"></a> `enabled` | `boolean` | Whether conversations are enabled for this team. |
| <a id="property-greetingtext"></a> `greetingText?` | `string` | Greeting text to show when the widget is first opened. |
| <a id="property-identificationformdescription"></a> `identificationFormDescription?` | `string` | Description for the identification form. |
| <a id="property-identificationformtitle"></a> `identificationFormTitle?` | `string` | Title for the identification form. |
| <a id="property-placeholdertext"></a> `placeholderText?` | `string` | Placeholder text for the message input. |
| <a id="property-requireemail"></a> `requireEmail?` | `boolean` | Whether to require an email address before starting a conversation. |
| <a id="property-token"></a> `token` | `string` | Public token for authenticating conversations API requests. |
| <a id="property-widgetenabled"></a> `widgetEnabled?` | `boolean` | Whether the widget UI should be shown. |
| <a id="property-widgetposition"></a> `widgetPosition?` | `WidgetPosition` | Position of the widget on the screen. |

### `DeadClicksAutoCaptureConfig`

> **DeadClicksAutoCaptureConfig** = `object` & `Pick`\<`AutocaptureConfig`, `"element_attribute_ignorelist"`\>

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `__onCapture()?` | (`click`, `properties`) => `void` | Allows setting behavior for when a dead click is captured. For e.g. to support capture to heatmaps If not provided the default behavior is to auto-capture dead click events Only intended to be provided by our own SDK |
| `capture_clicks_with_modifier_keys?` | `boolean` | By default, clicks with modifier keys (ctrl, shift, alt, meta/cmd) held down are not considered dead clicks, since these typically indicate intentional actions like "open in new tab". Set this to true to capture dead clicks even when modifier keys are held. **Default** `false` |
| `capture_dead_swipes?` | `boolean` | Determines whether PostHog should also detect "dead swipes" — touch swipe gestures (typically on mobile/touch devices) that produce no observable screen change (no scroll, mutation or selection change while the gesture is in progress, and no scroll, mutation, selection or visibility change afterwards). These usually indicate a failed navigation, e.g. swiping to go back or to move a carousel with nothing happening. Dead swipes are captured as `$dead_swipe` events. This only applies to the dead-click autocapture path, not the heatmaps path. Swipes over surfaces whose response cannot be observed — canvas, video and other media/plugin elements under the finger — are never captured, and capture is limited per page load (see `max_dead_swipes_per_page_load`). **Default** `true` |
| `css_selector_ignorelist?` | `string`[] | List of CSS selectors to ignore dead clicks on e.g. ['.my-download-link'] we consider the tree of elements from the root to the target element of the click event so for the tree div > div > a > svg and ignore list config `['[download]']` we will ignore the dead click if the click-target or its parents has any download attribute Nothing is ignored when there's an empty ignorelist, e.g. [] If no ignorelist is set, we default to ignoring .ph-no-deadclick and .ph-no-capture A custom ignorelist fully replaces the default — include .ph-no-capture if you want it to suppress dead-click capture as well |
| `max_dead_swipes_per_page_load?` | `number` | The maximum number of dead swipes captured per page load. Swipe gestures are plentiful on touch devices, so a page whose responses the detector cannot see is capped rather than allowed to flood events. Only used when `capture_dead_swipes` is enabled. **Default** `10` |
| `mutation_threshold_ms?` | `number` | We'll not consider a click to be a dead click, if it's followed by a mutation within `mutation_threshold_ms` milliseconds **Default** `2500` |
| `scroll_threshold_ms?` | `number` | We'll not consider a click to be a dead click, if it's followed by a scroll within `scroll_threshold_ms` milliseconds **Default** `100` |
| `selection_change_threshold_ms?` | `number` | We'll not consider a click to be a dead click if it selects/unselects text or moves a caret in editable content during its mouse gesture, regardless of how long the button is held. Selection changes outside a matching gesture suppress the click when they occur within `selection_change_threshold_ms` milliseconds immediately before or after it. When a closed shadow root hides whether a caret belongs to editable content, only the timed window applies. A value of 0 disables selection-based suppression. **Default** `100` |
| `swipe_threshold_px?` | `number` | The minimum straight-line distance in CSS pixels between where a touch gesture starts and ends for it to be considered a swipe (rather than a tap). Only used when `capture_dead_swipes` is enabled. **Default** `30` |

### `ExceptionAutoCaptureConfig`

> **ExceptionAutoCaptureConfig** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="capture_console_errors"></a> `capture_console_errors?` | `boolean` | Determines whether PostHog should capture console errors. **Default** `false` |
| <a id="capture_unhandled_errors"></a> `capture_unhandled_errors?` | `boolean` | Determines whether PostHog should capture unhandled errors. **Default** `true` |
| <a id="capture_unhandled_rejections"></a> `capture_unhandled_rejections?` | `boolean` | Determines whether PostHog should capture unhandled promise rejections. **Default** `true` |

### `ExceptionRateLimiterConfig`

Shared configuration for the error tracking burst-protection rate limiter.

Burst protection is scoped **per exception type** — the limiter is keyed by exception type, so
each distinct `$exception` type gets its own token bucket and there is no aggregate cap across
all types. It applies only to autocaptured exceptions; manual `captureException` calls are
never rate limited. These options let customers with high-cardinality exception types tune the
per-type allowance, and are shared between the browser and Node SDKs.

#### Extended by

- `ErrorTrackingOptions`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-exceptionratelimiterbucketsize"></a> `exceptionRateLimiterBucketSize?` | `number` | ADVANCED: alters the bucket size for the error tracking rate limiter's token bucket. Normally only altered alongside PostHog support guidance. Accepts values between 0 and 100. **Default** `10` |
| <a id="property-exceptionratelimiterrefillrate"></a> `exceptionRateLimiterRefillRate?` | `number` | ADVANCED: alters the refill rate for the error tracking rate limiter's token bucket. Normally only altered alongside PostHog support guidance. Accepts values between 0 and 100. **Default** `1` |

### `ExceptionStepsConfig`

> **ExceptionStepsConfig** = `object`

Controls buffering and payload limits for exception steps added via `addExceptionStep`.

NOTE: This type is also defined in `@posthog/core` (exception-steps.ts). Keep both in sync.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="enabled"></a> `enabled?` | `boolean` | Determines whether PostHog should collect exception steps and attach them to the next captured exception. **Default** `true` |
| <a id="max_bytes"></a> `max_bytes?` | `number` | The maximum UTF-8 byte budget for exception steps buffered in memory. Oldest steps are evicted when the budget is exceeded. **Default** `32768 (~32KB)` |

### `FeatureFlagsConfig`

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-bootstrap"></a> `bootstrap` | `readonly` | `object` | - |
| `bootstrap.featureFlagPayloads?` | `readonly` | `Readonly`\<`Record`\<`string`, `JsonType`\>\> | - |
| `bootstrap.featureFlags?` | `readonly` | `Readonly`\<`Record`\<`string`, `string` \| `boolean`\>\> | - |
| <a id="property-cachettlms"></a> `cacheTtlMs?` | `readonly` | `number` | - |
| <a id="property-compression"></a> `compression?` | `readonly` | `Compression` \| `"best-available"` | - |
| <a id="property-deduplicatecallspersession"></a> `deduplicateCallsPerSession` | `readonly` | `boolean` | - |
| <a id="property-encodebootstrappayloads"></a> `encodeBootstrapPayloads?` | `readonly` | `boolean` | Store bootstrapped payloads JSON-encoded, like payloads from `/flags`, so reads return them as supplied. Only `$feature_flag_bootstrapped_payload` reports the supplied value; `$feature_flag_payload` reports the stored JSON string, like payloads from `/flags`. |
| <a id="property-evaluationcontexts"></a> `evaluationContexts` | `readonly` | readonly `string`[] | - |
| <a id="property-featureflagsdisabled"></a> `featureFlagsDisabled` | `readonly` | `boolean` | - |
| <a id="property-flagkeys"></a> `flagKeys?` | `readonly` | readonly `string`[] | - |
| <a id="property-idlerefreshbackoff"></a> `idleRefreshBackoff` | `readonly` | `boolean` | - |
| <a id="property-onlyevaluatesurveyfeatureflags"></a> `onlyEvaluateSurveyFeatureFlags` | `readonly` | `boolean` | - |
| <a id="property-refreshintervalms"></a> `refreshIntervalMs?` | `readonly` | `number` | - |
| <a id="property-remoterequestsdisabled-1"></a> `remoteRequestsDisabled` | `readonly` | `boolean` | - |
| <a id="property-requestmaxretries"></a> `requestMaxRetries?` | `readonly` | `number` | - |
| <a id="property-requesttimeoutms"></a> `requestTimeoutMs` | `readonly` | `number` | - |

### `HeatmapConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-flush_interval_milliseconds"></a> `flush_interval_milliseconds` | `number` | How often to send batched data in `$heatmap_data` events If set to 0 or not set, sends using the default interval of 1 second **Default** `1000` |

### `LogsConfig`

Logs configuration options

#### Extends

- `LogCaptureOptions`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-beforesend-2"></a> `beforeSend?` | `BeforeSendLogFn` \| `BeforeSendLogFn`[] | Pre-send filter for log records, as a single function or a left-to-right chain. Each function inspects, mutates, or drops a record (return `null` to drop) before it enters the rate cap or the buffer. | `LogCaptureOptions`.`beforeSend` |
| <a id="property-captureconsolelogs-1"></a> `captureConsoleLogs?` | `boolean` | Automatically capture `console.*` calls as structured log records. Review console output before enabling, as messages can include sensitive values written by your code or by third-party libraries. The project setting can also turn this on. Console logs are captured when either one enables them. **Default** `undefined` | - |
| <a id="property-environment-2"></a> `environment?` | `string` | The deployment environment for log records (e.g. 'production', 'staging'). Maps to the OTel resource attribute 'deployment.environment'. | `LogCaptureOptions`.`environment` |
| <a id="property-flushintervalms-2"></a> `flushIntervalMs?` | `number` | Flush interval in milliseconds for batched log records. **Default** `3000` | `LogCaptureOptions`.`flushIntervalMs` |
| <a id="property-maxbuffersize-2"></a> `maxBufferSize?` | `number` | Maximum number of log records to buffer before forcing a flush. The queue may grow beyond this while a flush is in flight (e.g. during a synchronous burst) and is bounded separately by the per-interval rate cap. **Default** `100` | `LogCaptureOptions`.`maxBufferSize` |
| <a id="property-maxlogsperinterval-2"></a> `maxLogsPerInterval?` | `number` | Maximum number of log records accepted per flush interval. Subsequent calls within the same window are dropped with a single warning, protecting against runaway loggers flooding the network. Also sizes the in-memory buffer's eviction backstop, so a window's worth of records is held while a flush is in flight; raising it raises the worst-case in-memory footprint. **Default** `1000` | `LogCaptureOptions`.`maxLogsPerInterval` |
| <a id="property-resourceattributes-2"></a> `resourceAttributes?` | `LogAttributes` | Additional resource attributes applied to all log records. These describe the service/deployment, not individual log entries. Named fields (serviceName, environment, serviceVersion) are set first; resourceAttributes can override them. **Example** `{ 'host.name': 'web-01', 'cloud.region': 'us-east-1' }` | `LogCaptureOptions`.`resourceAttributes` |
| <a id="property-servicename-2"></a> `serviceName?` | `string` | The service name for log records. Maps to the OTel resource attribute 'service.name'. **Default** `'unknown_service'` | `LogCaptureOptions`.`serviceName` |
| <a id="property-serviceversion-2"></a> `serviceVersion?` | `string` | The service version for log records (e.g. '1.2.3'). Maps to the OTel resource attribute 'service.version'. | `LogCaptureOptions`.`serviceVersion` |

### `MetricsConfig`

Options for the posthog.metrics API (count, gauge, histogram).
Shared by every SDK; browser-only options live in `BrowserMetricsConfig`.

#### Extended by

- `BrowserMetricsConfig`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-beforesend-1"></a> `beforeSend?` | `BeforeSendMetricFn` \| `BeforeSendMetricFn`[] | Pre-aggregation filter for metric samples, as a single function or a left-to-right chain. Each function inspects, mutates, or drops a sample (return `null` to drop) before it is aggregated. |
| <a id="property-environment-1"></a> `environment?` | `string` | The deployment environment for metric series (e.g. 'production', 'staging'). Maps to the OTel resource attribute 'deployment.environment'. |
| <a id="property-flushintervalms-1"></a> `flushIntervalMs?` | `number` | How often the aggregated window is flushed, in milliseconds. Samples are folded into per-series aggregates in memory between flushes — one data point per series per window, no matter how many calls. The browser SDK defaults to 60000: every tab of an app writes to the same series, so a longer window keeps busy series under the backend's per-series point limit. **Default** `10000 (60000 in the browser)` |
| <a id="property-maxseriesperflush-1"></a> `maxSeriesPerFlush?` | `number` | Cardinality guardrail: maximum distinct series (name + type + unit + attribute combination) held per flush window. Samples for series beyond the cap are dropped with a single warning per window. **Default** `1000` |
| <a id="property-resourceattributes-1"></a> `resourceAttributes?` | `MetricAttributes` | Additional resource attributes applied to every metrics batch. These describe the service/deployment, not individual series. Named fields (serviceName, environment, serviceVersion) are set first; resourceAttributes can override them. **Example** `{ 'host.name': 'web-01', 'cloud.region': 'us-east-1' }` |
| <a id="property-servicename-1"></a> `serviceName?` | `string` | The service name for metric series. Maps to the OTel resource attribute 'service.name'. **Default** `'unknown_service'` |
| <a id="property-serviceversion-1"></a> `serviceVersion?` | `string` | The service version for metric series (e.g. '1.2.3'). Maps to the OTel resource attribute 'service.version'. |

### `NetworkMetricsConfig`

Options for automatic HTTP and HTTPS `fetch` and `XMLHttpRequest` duration
metrics. Recording never changes the request or its settlement. Fetch returns
a derived promise so rejected requests remain observable to the caller.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attributes-4"></a> `attributes?` | (`request`, `response`) => `MetricAttributes` \| `undefined` | Adds attributes to each recorded request. The result is merged over the default attributes, so it can also replace them, e.g. to set `url.template` to a route template. Keep attribute values low-cardinality. The default attributes follow the OTel HTTP client semantic conventions: `http.request.method`, `server.address`, `server.port`, `url.scheme`, `url.template`, `http.response.status_code` and `error.type`. The default `url.template` replaces each all-digit or uuid-like path segment with `:id`. Ids that carry a prefix or suffix, such as `order-123` or `38217.pdf`, are kept as they are, so return your own `url.template` for those routes. `http.response.status_code` is only set when a response arrived. `error.type` is the status code for a 4xx or 5xx response, the error name (e.g. `TypeError`) for a rejected fetch, or `_OTHER` when no response arrived and there is no error. |
| <a id="property-name-3"></a> `name?` | `string` \| ((`request`) => `string` \| `null` \| `undefined`) | The metric name. A string is used for every request. A function is called once per request; return a falsy value to skip that request. **Default** `'http.client.request.duration'` |

### `OverrideConfig`

> **OverrideConfig** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="event_trigger"></a> `event_trigger` | `boolean` |
| <a id="linked_flag"></a> `linked_flag` | `boolean` |
| <a id="sampling"></a> `sampling` | `boolean` |
| <a id="url_trigger"></a> `url_trigger` | `boolean` |

### `PerformanceCaptureConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-__preview_web_vitals_soft_navs"></a> `__preview_web_vitals_soft_navs?` | `boolean` | Scope web vitals metrics to the browser's Soft Navigation entries, so that client-side route changes in single-page apps each start a fresh measurement window instead of accumulating against the original hard-navigation timestamp. Without this, an SPA's LCP observer keeps treating the "largest paint so far" as belonging to the initial page load across every subsequent route change, which inflates LCP (and the other metrics) by the time spent on the app. This is a preview option (opt-in) because it relies on Chrome's Soft Navigation Detection API, which is still experimental. When enabled, PostHog loads a pinned stable web-vitals 6.x bundle and passes `reportSoftNavs` to the observers. The default path remains on the existing web-vitals 5.x bundle. In browsers without soft-nav support, metrics fall back to their existing hard-navigation behavior. **Default** `false` |
| <a id="property-__web_vitals_max_value"></a> `__web_vitals_max_value?` | `number` | We observe very large values reported by the Chrome web vitals library These outliers are likely not real, useful values, and we exclude them You can set this to 0 in order to include all values, NB this is not recommended **Default** `15 * 60 * 1000 (15 minutes)` |
| <a id="property-network_timing"></a> `network_timing?` | `boolean` | Works with session replay to use the browser's native performance observer to capture performance metrics |
| <a id="property-web_vitals"></a> `web_vitals?` | `boolean` | Use chrome's web vitals library to wrap fetch and capture web vitals When `cookieless_mode` is active, there is no client-side SessionIdManager; vitals are still captured. Nested `$web_vitals_*_event` payloads omit `$session_id` / `$window_id`; PostHog ingestion assigns `$session_id` server-side for cookieless traffic when project cookieless settings are enabled (same as other events). A boolean here overrides the project setting. When unset, the project setting applies. |
| <a id="property-web_vitals_allowed_metrics"></a> `web_vitals_allowed_metrics?` | `SupportedWebVitalsMetrics`[] | By default all 4 metrics are captured You can set this config to restrict which metrics are captured e.g. ['CLS', 'FCP'] to only capture those two metrics NB setting this does not override whether the capture is enabled **Default** `['LCP', 'CLS', 'FCP', 'INP']` |
| <a id="property-web_vitals_attribution"></a> `web_vitals_attribution?` | `boolean` \| `SupportedWebVitalsMetrics`[] | Which web vitals metrics include attribution data. Attribution names the cause of a metric, such as the slow interaction target for INP or the load-phase breakdown for LCP, which is what makes a slow number diagnosable. Pass `true` to attribute all metrics, `false` for none, or an array to name them. The default attributes INP and LCP only. CLS is excluded by default because its attribution holds detached DOM nodes and can leak memory in single-page apps. **Default** `['INP', 'LCP']` |
| <a id="property-web_vitals_delayed_flush_ms"></a> `web_vitals_delayed_flush_ms?` | `number` | We delay flushing web vitals metrics to reduce the number of events we send This is the maximum time we will wait before sending the metrics **Default** `5000` |

### `PostHogConfig`

> **PostHogConfig** = `Omit`\<`PostHogConfig`, `"loaded"`\> & `object`

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `disableDeviceModel?` | `boolean` | Disables capturing the `$device_model` super-property. When capturing is enabled (the default), PostHog resolves the hardware model once during init via `navigator.userAgentData.getHighEntropyValues(['model'])` and registers it as the raw OEM code (e.g. `Pixel 7`). This is Chromium-only and only meaningful on Android — it resolves to `undefined` on Safari/Firefox and to an empty string on desktop, in which cases nothing is registered. This opt-out is offered because `getHighEntropyValues` is still experimental and Chromium-only (not yet a cross-browser standard); set it to `true` to skip the call entirely. **Default** `false` |
| `loaded()` | (`posthog`) => `void` | - |

### `PostHogConfig`

Configuration options for the PostHog JavaScript SDK.

#### See

https://posthog.com/docs/libraries/js/config

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-__add_tracing_headers"></a> ~~`__add_tracing_headers?`~~ | `string`[] | **Deprecated** Use tracing\_headers instead. Kept for backwards compatibility. |
| <a id="property-__preview_capture_bot_pageviews"></a> `__preview_capture_bot_pageviews?` | `boolean` | PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION Enables collection of bot traffic as $bot_pageview events with detailed bot detection properties instead of dropping them entirely. Use it alongside opt_out_useragent_filter |
| <a id="property-__preview_cookie_wins_on_conflict"></a> ~~`__preview_cookie_wins_on_conflict`~~ | `boolean` | **Deprecated** Use `cookieWinsOnConflict` instead. |
| <a id="property-__preview_deferred_init_extensions"></a> `__preview_deferred_init_extensions` | `boolean` | **`Experimental`** EXPERIMENTAL: Defers initialization of non-critical extensions (autocapture, session recording, etc.) to the next event loop tick using setTimeout. This reduces main thread blocking during SDK initialization for better page load performance, while keeping critical functionality (persistence, sessions, capture) available immediately. When enabled: - Persistence, sessions, and basic capture work immediately - Extensions (autocapture, recording, heatmaps, etc.) start after yielding back to the browser **Default** `false (will be true for defaults >= '2025-11-06' in the future) @experimental` |
| <a id="property-__preview_disable_beacon"></a> ~~`__preview_disable_beacon?`~~ | `boolean` | **Deprecated** Use `disable_beacon` instead. |
| <a id="property-__preview_disable_xhr_credentials"></a> ~~`__preview_disable_xhr_credentials?`~~ | `boolean` | **Deprecated** This option is a no-op. The browser SDK no longer sets `XMLHttpRequest.withCredentials`. |
| <a id="property-__preview_eager_load_replay"></a> ~~`__preview_eager_load_replay?`~~ | `boolean` | **Deprecated** This option is a no-op. Session replay is lazy-loaded by default. |
| <a id="property-__preview_external_dependency_versioned_paths"></a> ~~`__preview_external_dependency_versioned_paths?`~~ | `string` \| `boolean` | **Deprecated** Use strict\_script\_versioning and asset\_host instead. When set to true, this is equivalent to strict_script_versioning: true. When set to a string, this is equivalent to strict_script_versioning: true and asset_host set to that string. |
| <a id="property-__preview_flags_v2"></a> ~~`__preview_flags_v2?`~~ | `boolean` | **Deprecated** This option is a no-op. The browser SDK already uses the `/flags/?v=2` endpoint. |
| <a id="property-__preview_lazy_load_replay"></a> ~~`__preview_lazy_load_replay?`~~ | `boolean` | **Deprecated** - does nothing was present only for PostHog testing of replay lazy loading |
| <a id="property-__preview_replay_sync_fetch"></a> `__preview_replay_sync_fetch?` | `boolean` | Private preview: invoke recorded fetch requests synchronously to preserve application error stacks. Enabled by default in new cores; set to `false` to retain legacy fetch ordering. An old core without this option also retains legacy ordering when it loads a new recorder. Applied when the recorder installs its network observers, not a live remote kill switch. **Default** `true` |
| <a id="property-_oncapture"></a> ~~`_onCapture`~~ | (`eventName`, `eventData`) => `void` | **Deprecated** - use `before_send` instead |
| <a id="property-addtracingheaders"></a> ~~`addTracingHeaders?`~~ | `string`[] | **Deprecated** Use tracing\_headers instead. Kept for backwards compatibility. |
| <a id="property-advanced_disable_decide"></a> ~~`advanced_disable_decide?`~~ | `boolean` | **Deprecated** Use `advanced_disable_flags` instead. This will be removed in a future major version. One of the very first things the PostHog library does when init() is called is make a request to the /decide endpoint on PostHog's backend. This endpoint contains information on how to run the PostHog library so events are properly received in the backend. This endpoint is required to run most features of the library. However, if you're not using any of the described features, you may wish to turn off the call completely to avoid an extra request and reduce resource usage on both the client and the server. **Default** `false` |
| <a id="property-advanced_disable_feature_flags"></a> `advanced_disable_feature_flags` | `boolean` | Will keep /flags running, but without evaluating any feature flags. Useful for when you need to load the config data associated with the flags endpoint (e.g. /flags?v=2&config=true) without evaluating any feature flags. Most folks use this to save money on feature flag evaluation (by bootstrapping feature flags on the server side). This also stops surveys from displaying. PostHog creates an internal targeting flag for almost every survey, and every flag evaluates to false while flags are disabled. If you use surveys, set `advanced_only_evaluate_survey_feature_flags` instead, which evaluates survey flags only. **Default** `false` |
| <a id="property-advanced_disable_feature_flags_on_first_load"></a> `advanced_disable_feature_flags_on_first_load` | `boolean` | Stops from firing feature flag requests on first page load. Only requests feature flags when user identity or properties are updated, or you manually request for flags to be loaded. **Default** `false` |
| <a id="property-advanced_disable_flags"></a> `advanced_disable_flags?` | `boolean` | One of the very first things the PostHog library does when init() is called is make a request to the /flags endpoint on PostHog's backend. This endpoint contains information on how to run the PostHog library so events are properly received in the backend, and it also contains feature flag evaluation information for the current user. This endpoint is required to run most features of this library. However, if you're not using any of the described features, you may wish to turn off the call completely to avoid an extra request and reduce resource usage on both the client and the server. WARNING: Disabling this will also prevent remote configuration from loading, which could mean features like web vitals, surveys, and other features configured in PostHog settings are disabled unless explicitly enabled via client-side config. When setting this to true, make sure to explicitly configure any features you want to use (e.g., capture_performance, autocapture, etc.) in your SDK's init config. **Default** `false` |
| <a id="property-advanced_disable_toolbar_metrics"></a> `advanced_disable_toolbar_metrics` | `boolean` | Determines whether PostHog should disable toolbar metrics. This is our internal instrumentation for our toolbar in your website. **Default** `false` |
| <a id="property-advanced_enable_surveys"></a> `advanced_enable_surveys` | `boolean` | When this is enabled, surveys will always be initialized, regardless of the /flags response or remote config settings. This is useful if you want to use surveys but disable all other flag-dependent functionality. Used internally for displaying external surveys without making a /flags request. **Default** `false` |
| <a id="property-advanced_feature_flags_dedup_per_session"></a> `advanced_feature_flags_dedup_per_session` | `boolean` | When enabled, `$feature_flag_called` event deduplication is scoped to the current session. By default, the SDK deduplicates `$feature_flag_called` events globally and only re-emits them when `identify` (with a new distinct ID) or `reset` is called. This can be problematic for experiments: if a flag is checked before an experiment starts, the event is cached and won't fire again for that user until identify/reset, meaning the experiment never sees the event. When this option is `true`, the deduplication cache is keyed on the session ID, so each new session will re-emit `$feature_flag_called` for every flag that is checked. **Default** `false` |
| <a id="property-advanced_only_evaluate_survey_feature_flags"></a> `advanced_only_evaluate_survey_feature_flags` | `boolean` | Determines whether PostHog should only evaluate feature flags for surveys. Useful for when you want to use this library to evaluate feature flags for surveys only but you have additional feature flags that you evaluate on the server side. **Default** `false` |
| <a id="property-api_host"></a> `api_host` | `string` | URL of your PostHog instance. **Default** `'https://us.i.posthog.com'` |
| <a id="property-api_method"></a> ~~`api_method?`~~ | `string` | **Deprecated** - NOT USED ANYMORE, kept here for backwards compatibility reasons |
| <a id="property-api_transport"></a> `api_transport?` | `"XHR"` \| `"fetch"` | The transport method to use for API requests. **Default** `'fetch'` |
| <a id="property-asset_host"></a> `asset_host` | `string` \| `null` | Optional host override for static assets loaded by PostHog, such as recorder.js, surveys.js, or toolbar.js. Only applies to /static/* asset paths; dynamic assets like remote config continue to use the regular asset host derived from api_host. **Default** `null` |
| <a id="property-autocapture"></a> `autocapture` | `boolean` \| `AutocaptureConfig` | Determines whether PostHog should autocapture events. This setting does not affect capturing pageview events (see `capture_pageview`). by default autocapture is ignored on elements that match a `ph-no-capture` css class on the element or a parent The project setting can also turn autocapture off. Events are autocaptured only when both allow it. **Default** `true` |
| <a id="property-before_send"></a> `before_send?` | `BeforeSendFn` \| `BeforeSendFn`[] | This function or array of functions - if provided - are called immediately before sending data to the server. It allows you to edit data before it is sent, or choose not to send it all. if provided as an array the functions are called in the order they are provided any one function returning null means the event will not be sent |
| <a id="property-bootstrap-1"></a> `bootstrap` | `BootstrapConfig` | An object containing the `distinctID`, `isIdentifiedID`, and `featureFlags` keys, where `distinctID` is a string, and `featureFlags` is an object of key-value pairs. Since there is a delay between initializing PostHog and fetching feature flags, feature flags are not always available immediately. This makes them unusable if you want to do something like redirecting a user to a different page based on a feature flag. You can, therefore, fetch the feature flags in your server and pre-fill them here, allowing PostHog to know the feature flag values immediately. After the SDK fetches feature flags from PostHog, it will use those flag values instead of bootstrapped ones. **Default** `{}` |
| <a id="property-capture_dead_clicks"></a> `capture_dead_clicks?` | `boolean` \| `DeadClicksAutoCaptureConfig` | Determines whether to capture dead clicks. by default dead clicks are ignored on elements that match a `ph-no-capture` or `ph-no-deadclick` css class on the element or a parent **See** **Default** `undefined` |
| <a id="property-capture_exceptions"></a> `capture_exceptions?` | `boolean` \| `ExceptionAutoCaptureConfig` | Determines whether to capture exceptions. When set, this overrides the project setting. When unset, the project setting applies. **See** **Default** `undefined` |
| <a id="property-capture_heatmaps"></a> `capture_heatmaps?` | `boolean` \| `HeatmapConfig` | Determines whether to capture heatmaps. When set, this overrides the project setting. When unset, the project setting applies. **See** **Default** `undefined` |
| <a id="property-capture_pageleave"></a> `capture_pageleave` | `boolean` \| `"if_capture_pageview"` | Determines whether PostHog should capture pageleave events. If set to `true`, it will capture pageleave events for all pages. If set to `'if_capture_pageview'`, it will only capture pageleave events if `capture_pageview` is enabled. **Default** `'if_capture_pageview'` |
| <a id="property-capture_pageview"></a> `capture_pageview` | `boolean` \| `CapturePageviewOptions` \| `"history_change"` | Determines whether PostHog should capture pageview events automatically. Can be: - `true`: Capture the initial pageview - `false`: Don't capture any pageviews - `'history_change'`: Capture the initial pageview and pageviews when the pathname changes - An object: Capture the initial pageview and pageviews when any selected URL component changes With the slim bundle, history-based pageviews require `AnalyticsExtensions.historyAutocapture` from `posthog-js/extensions` in `__extensionClasses`. Without it, only the initial pageview is captured. **Default** true (or `'history_change'` when `defaults` is `'2025-05-24'` or later) |
| <a id="property-capture_performance"></a> `capture_performance?` | `boolean` \| `PerformanceCaptureConfig` | Determines whether to capture performance metrics. These include Network Timing for Session Replay and Web Vitals. The `network_timing` option is only used by the Session Replay feature. For more session recording settings, see the `session_recording` and `enable_recording_console_log` configuration option. When `undefined`, fallback to the remote configuration. If `false`, neither network timing nor web vitals will work. If an object, that will override the remote configuration. **See** **Default** `undefined` |
| <a id="property-capture_webmcp"></a> `capture_webmcp?` | `boolean` \| `WebMCPCaptureConfig` | Captures WebMCP tool calls as `$mcp_tool_call` events. Set this option to `true` to capture intent and model metadata. Use an object to disable either field. PostHog wraps tools registered after the SDK initializes. Tool inputs and outputs are not captured. Metadata options are applied when each tool registers. Changing them does not update registered schemas; re-register the tool to apply the new options. **Default** `false` |
| <a id="property-consent_persistence_name"></a> `consent_persistence_name` | `string` \| `null` | Determines the key for the cookie / local storage used to store the information about whether users are opted in/out of capturing. When `null`, we used a key based on your token. **Default** `null` **See** `ConsentManager._storageKey` |
| <a id="property-conversations"></a> `conversations?` | `ConversationsConfig` | Conversations-specific configuration options, such as the support widget theme. **Default** `undefined` |
| <a id="property-cookie_expiration"></a> `cookie_expiration` | `number` | Determines the number of days to store cookies for. **Default** `365` |
| <a id="property-cookie_name"></a> ~~`cookie_name?`~~ | `string` | **Deprecated** - Use 'persistence_name' instead |
| <a id="property-cookie_persisted_properties"></a> `cookie_persisted_properties?` | readonly `string`[] | List of custom property names that should be stored in cookies (in addition to the default ones) when using 'localStorage+cookie' persistence mode. This allows these properties to be shared across subdomains when cross_subdomain_cookie is enabled. Cookies hold about 4KB, so large values can cause `431 Request Header Fields Too Large` errors. **Default** `[]` |
| <a id="property-cookieless_mode"></a> `cookieless_mode?` | `"always"` \| `"on_reject"` | Enables cookieless mode. In this mode, PostHog will not set any cookies, or use session or local storage. User identity is handled by generating a privacy-preserving hash on PostHog's servers. Web Vitals (`capture_performance.web_vitals`) are supported: metrics are sent without client session IDs; ingestion assigns `$session_id` when cookieless mode is enabled for the project. - 'always' - enable cookieless mode immediately on startup, use this if you do not intend to show a cookie banner - 'on_reject' - enable cookieless mode only if the user rejects cookies, use this if you want to show a cookie banner. If the user accepts cookies, cookieless mode will not be used, and PostHog will use cookies and local storage as usual. Note that you MUST enable cookieless mode in your PostHog project's settings, otherwise all your cookieless events will be ignored. We plan to remove this requirement in the future. |
| <a id="property-cookiewinsonconflict"></a> `cookieWinsOnConflict` | `boolean` | In `'localStorage+cookie'` persistence mode, prefer shared cookie values over per-origin localStorage when both stores carry the same key. The SDK also checks for cookie changes before captures and persistence writes so already-open sibling subdomains adopt identity changes made by `identify()` or `reset()`. Synchronization happens on the tab's next PostHog activity, not immediately. A persistence write can adopt an identity without immediately reloading feature flags. When the SDK next processes that identity, such as before a capture, it clears identity-bound flag state and starts a reload. `onFeatureFlags` runs after that reload. If the session ID changes, `onSessionId` runs when the tab next checks its session. A synchronized `reset()` also clears event and session properties of the previous identity. When `defaults` is `'2026-08-29'` or later, this defaults to `true`. Requires `posthog-js` 1.418.0 or later. **Default** `false` |
| <a id="property-cross_subdomain_cookie"></a> `cross_subdomain_cookie` | `boolean` | Determines if cookie should be set on the top level domain (example.com). If PostHog-js is loaded on a subdomain (test.example.com), and `cross_subdomain_cookie` is set to false, it'll set the cookie on the subdomain only (test.example.com). NOTE: It will be set to `false` if we detect that the domain is a subdomain of a platform that is excluded from cross-subdomain cookie setting. The current list of excluded platforms is `herokuapp.com`, `vercel.app`, and `netlify.app`. **See** `isCrossDomainCookie` **Default** `true` |
| <a id="property-custom_blocked_useragents"></a> `custom_blocked_useragents` | `string`[] | Used to extend the list of user agents that are blocked by default. **See** from './utils/blocked-uas' - Default list of blocked user agents. **Default** `[]` |
| <a id="property-custom_campaign_params"></a> `custom_campaign_params` | `string`[] | Used to extend the list of campaign parameters that are saved by default. **See** from './utils/event-utils' - Default campaign parameters like utm_source, utm_medium, etc. **Default** `[]` |
| <a id="property-custom_personal_data_properties"></a> `custom_personal_data_properties` | `string`[] | Custom list of personal data properties to mask. E.g. if you added `email` to this list, then any `email` property in the URL will be masked. https://www.example.com/login?email=john.doe%40example.com => https://www.example.com/login?email=<MASKED> **Default** `[]` **See** - Must be enabled for this to take effect. |
| <a id="property-debug"></a> `debug` | `boolean` | Determines whether PostHog should be in debug mode. You can enable this to get more detailed logging. You can also enable this on your website by appending `?__posthog_debug=true` at the end of your URL You can also call `posthog.debug()` in your code to enable debug mode **Default** `false` |
| <a id="property-defaults"></a> `defaults` | `ConfigDefaults` | Configuration defaults for breaking changes. When set to a specific date, enables new default behaviors that were introduced on that date. Set to `'latest'` to always use the newest defaults in the loaded SDK version. Unlike a pinned date, `'latest'` opts into future default changes when the SDK is upgraded, which may include breaking changes. Explicit configuration options still take precedence. Events report the resolved date in `$config_defaults` when using `'latest'`. - `'latest'`: Use all default changes available in the loaded SDK version - `'unset'`: Use legacy default behaviors - `'2025-05-24'`: Use updated default behaviors (e.g. capture_pageview defaults to 'history_change') - `'2025-11-30'`: Defaults from '2025-05-24' plus additional changes (e.g. strict minimum duration for replay and rageclick content ignore list defaults to active) - `'2026-01-30'`: Defaults from '2025-11-30' plus external_scripts_inject_target defaults to 'head' (avoids SSR hydration errors) - `'2026-05-30'`: Defaults from '2026-01-30' plus `persistence_save_debounce_ms` defaults to `250`, `split_storage` and `detect_google_search_app` default to `true`, and rageclick defaults also exclude stepper controls and text-selection surfaces - `'2026-06-25'`: Defaults from '2026-05-30' plus `session_recording.streamNetworkBody` defaults to `true` (streams network bodies to enforce the payload size limit) - `'2026-08-29'`: Defaults from '2026-06-25' plus `cookieWinsOnConflict` defaults to `true` (the shared cross-subdomain cookie wins over stale per-origin localStorage) - `'2026-08-30'`: Defaults from '2026-08-29' plus `session_recording.captureJsonLd` defaults to `true` **Default** `'unset'` |
| <a id="property-detect_google_search_app"></a> `detect_google_search_app?` | `boolean` | Detect the Google Search App (GSA) as its own `$browser` value instead of the underlying webview it embeds — Mobile Safari on iOS, Chrome on Android. Detection keys off the `GSA/` marker present in the UA on every platform. Off by default for backwards-compatibility: enabling it reattributes existing GSA traffic away from Mobile Safari / Chrome, which would otherwise look like those browsers suddenly losing share. The `2026-05-30` config default opts in. **Default** `false` |
| <a id="property-disable_beacon"></a> `disable_beacon?` | `boolean` | Prevents posthog-js from using the `navigator.sendBeacon` API to send events. Enabling this option may hurt the reliability of sending $pageleave events. |
| <a id="property-disable_capture_url_hashes"></a> `disable_capture_url_hashes` | `boolean` | Determines whether PostHog should strip URL fragments (`#...`) from automatically captured URL fields. Disabled by default for backwards compatibility, and enabled automatically when `config.defaults` is `'2026-06-25'` or later. Set to `true` to strip hashes from: - `$current_url` on automatically captured browser events, including `$pageview` - `$initial_current_url` - `$session_entry_url` - `$elements[*].attr__href` and `$external_click_url` for autocapture and dead-click autocapture - Next.js Pages Router `$pageview` `$current_url` - web vitals `$current_url` - logs `url.full` - conversations `current_url` and `request_url` - session replay rrweb meta/custom-event `href` URLs - heatmap data URLs If your SPA relies on hash-based routes for analytics, enabling this is a breaking behavior change. If you want to capture hashes selectively, leave this disabled and use `before_send` to remove sensitive hash values before events are sent. **Default** false when `config.defaults` is unset or earlier than `'2026-06-25'`, otherwise `true` |
| <a id="property-disable_compression"></a> `disable_compression` | `boolean` | Determines whether to disable compression when sending events to the server. WARNING: Should only be used for testing. Could negatively impact performance. **Default** `false` |
| <a id="property-disable_conversations"></a> `disable_conversations` | `boolean` | Determines whether PostHog should disable all conversations functionality. **Default** `false` |
| <a id="property-disable_cookie"></a> ~~`disable_cookie?`~~ | `boolean` | **Deprecated** - use `disable_persistence` instead |
| <a id="property-disable_external_dependency_loading"></a> `disable_external_dependency_loading` | `boolean` | Determines whether PostHog should disable any external dependency loading. This will prevent PostHog from requesting any external scripts such as those needed for Session Replay, Surveys or Site Apps. **Default** `false` |
| <a id="property-disable_persistence"></a> `disable_persistence` | `boolean` | Determines whether PostHog should disable persistence. If set to `true`, the library will not save any data to the browser. It will also delete any data previously saved to the browser. **Default** `false` |
| <a id="property-disable_product_tours"></a> `disable_product_tours` | `boolean` | Determines whether PostHog should disable all product tours functionality. **Default** `false` |
| <a id="property-disable_scroll_properties"></a> `disable_scroll_properties?` | `boolean` | Determines whether to disable scroll properties. These allow you to keep track of how far down someone scrolled in your website. **Default** `false` |
| <a id="property-disable_session_recording"></a> `disable_session_recording` | `boolean` | Determines whether PostHog should disable session recording. Recording starts only when this option and the project setting both allow it. **Default** `false` |
| <a id="property-disable_surveys"></a> `disable_surveys` | `boolean` | Determines whether PostHog should disable all surveys functionality. **Default** `false` |
| <a id="property-disable_surveys_automatic_display"></a> `disable_surveys_automatic_display` | `boolean` | Determines whether PostHog should disable automatic display of surveys. If this is true, popup or widget surveys will not be shown when display conditions are met. **Default** `false` |
| <a id="property-disable_web_experiments"></a> `disable_web_experiments` | `boolean` | Determines whether PostHog should disable web experiments. Currently disabled while we're in BETA. It will be toggled to `true` in a future release. **Default** `true` |
| <a id="property-enable_heatmaps"></a> ~~`enable_heatmaps?`~~ | `boolean` | **Deprecated** Use `capture_heatmaps` instead. |
| <a id="property-enable_recording_console_log"></a> `enable_recording_console_log?` | `boolean` | Determines whether PostHog should enable recording console logs. This is related to the Session Recording feature. For more session recording settings, see the `session_recording` and `capture_performance` configuration option. When undefined, it falls back to the remote config setting. **Default** `undefined` |
| <a id="property-error_tracking"></a> `error_tracking` | `ErrorTrackingOptions` | Determines the error tracking options. **See** `ErrorTrackingOptions` **Default** `{}` |
| <a id="property-evaluation_contexts"></a> `evaluation_contexts?` | readonly `string`[] | Evaluation contexts for feature flags. When set, only feature flags that have at least one matching evaluation tag will be evaluated for this SDK instance. Feature flags with no evaluation tags will always be evaluated. Examples: ['production', 'web', 'checkout'] **Default** `undefined` |
| <a id="property-evaluation_environments"></a> ~~`evaluation_environments?`~~ | readonly `string`[] | Evaluation environments for feature flags. **Deprecated** Use evaluation_contexts instead. This property will be removed in a future version. |
| <a id="property-external_scripts_inject_target"></a> `external_scripts_inject_target?` | `"body"` \| `"head"` | Where to inject external dependency scripts (recorder, surveys, etc.) in the DOM. - 'body': Injects scripts into document.body (legacy behavior) - 'head': Injects scripts into document.head (avoids SSR hydration errors) **Default** `'body' (or 'head' when defaults >= '2026-01-30')` |
| <a id="property-feature_flag_cache_ttl_ms"></a> `feature_flag_cache_ttl_ms?` | `number` | Sets the maximum age (in milliseconds) for cached feature flag values. When the cache is older than this value: - `getFeatureFlag()` will return `undefined` instead of stale cached values - `$feature/` properties will not be attached to events - A background refresh will be triggered automatically This prevents stale feature flag values from being used when the `/flags` request fails (e.g., due to ad blockers or network issues). When not set or set to `0`, cache expiration is disabled (cached values never expire). **Default** `0` |
| <a id="property-feature_flag_request_max_retries"></a> `feature_flag_request_max_retries` | `number` | How many times to retry a `/flags` request before giving up. Only failures that are plausibly transient are retried: HTTP 502 and 504, and a request that timed out. Every other status is terminal, as is a transport failure that is not a timeout — in a browser those are usually an ad blocker, an extension or CORS, which the status-zero circuit breaker already handles, so retrying them would only add a second doomed request. Set to 0 to disable retries. **Default** `1` |
| <a id="property-feature_flag_request_timeout_ms"></a> `feature_flag_request_timeout_ms` | `number` | Sets timeout for fetching feature flags **Default** `3000` |
| <a id="property-fetch_options"></a> `fetch_options?` | `object` | Used when sending data via `fetch`, use with care. This is intentionally meant to be used with NextJS `fetch` Incorrect `cache` usage may cause out-of-date data for feature flags, actions tracking, etc. |
| `fetch_options.cache?` | `RequestCache` | - |
| `fetch_options.next_options?` | `NextOptions` | - |
| <a id="property-flag_keys"></a> `flag_keys?` | readonly `string`[] | List of feature flag keys to remotely evaluate for this SDK instance. When set, only these flags are evaluated by `/flags`; omitted flags are not remotely evaluated. Dependencies of the requested flags may still be evaluated internally by PostHog. If unset, all eligible flags are evaluated. Examples: ['checkout-redesign', 'new-onboarding'] **Default** `undefined` |
| <a id="property-flags_api_host"></a> `flags_api_host?` | `string` \| `null` | URL to use for feature flag requests specifically. If not set, feature flag requests will use the URL derived from `api_host`. This is useful when you want to route feature flag requests to a different endpoint than other analytic APIs. **Default** `null` |
| <a id="property-get_current_url"></a> `get_current_url?` | (`defaultUrl`) => `string` | Overrides the URL used for client-side URL targeting: session replay URL triggers, the session replay URL blocklist, survey URL display conditions, product tour URL conditions, web experiment URL conditions, and autocapture URL allow/ignore lists. These features match against `window.location.href` directly, which does not reflect any `$current_url` you rewrite in `before_send`. In environments where the browser URL is not meaningful for targeting — e.g. Electron/desktop apps served from a generated host — return the logical URL you want these features to match against. This does not change the `$current_url` property captured on events (use `before_send` for that). **Default** undefined (uses `window.location.href`) |
| <a id="property-get_device_id"></a> `get_device_id` | (`uuid`) => `string` | Function to get the device ID. This doesn't usually need to be set, but can be useful if you want to use a custom device ID. **Default** `(uuid) => uuid` |
| <a id="property-identity_claims"></a> `identity_claims?` | `Record`\<`string`, \{ `hash`: `string`; `value`: `string`; \}\> | Additional server-signed identity claims. Claims are forwarded to products such as conversations only when `identity_distinct_id` and `identity_hash` are also present. Claim verification and consumption happen server-side. |
| <a id="property-identity_distinct_id"></a> `identity_distinct_id?` | `string` | Verified distinct_id for HMAC-based identity verification. When both `identity_distinct_id` and `identity_hash` are provided, products like conversations use server-verified identity instead of anonymous session identifiers. Can be set at init time or later via `posthog.setIdentity()`. **Example** `posthog.init('phc_...', { identity_distinct_id: 'user_123', identity_hash: 'a1b2c3d4e5f6...', })` |
| <a id="property-identity_hash"></a> `identity_hash?` | `string` | HMAC-SHA256 of `identity_distinct_id`, signed with the Secret API key from Support settings. Project secret API keys (project settings) and personal API keys are rejected. Must be provided together with `identity_distinct_id`. |
| <a id="property-inapp_link_new_window"></a> ~~`inapp_link_new_window?`~~ | `boolean` | **Deprecated** - NOT USED ANYMORE, kept here for backwards compatibility reasons |
| <a id="property-inapp_protocol"></a> ~~`inapp_protocol?`~~ | `string` | **Deprecated** - NOT USED ANYMORE, kept here for backwards compatibility reasons |
| <a id="property-integrations"></a> `integrations?` | `Record`\<`ExternalIntegrationKind`, `boolean`\> | Used to set-up external integrations with PostHog data - such as session replays, distinct id, etc. |
| <a id="property-internal_or_test_user_hostname"></a> `internal_or_test_user_hostname?` | `string` \| `RegExp` \| `null` | A hostname pattern to match test environments. When the current hostname matches, `setInternalOrTestUser()` is called automatically on startup, enabling person processing and setting `$internal_or_test_user: true`. Can be a string (exact match) or RegExp (pattern match). Set to `null` to explicitly disable (useful when using `defaults: '2026-01-30'`). **Default** `undefined (when defaults is before '2026-01-30')` **Default** `/^(localhost\|127\.0\.0\.1)$/ (when defaults >= '2026-01-30')` **Example** `// Exact match posthog.init('token', { internal_or_test_user_hostname: 'example.com' }) // Regex pattern posthog.init('token', { internal_or_test_user_hostname: /\.local$/ }) // Disable posthog.init('token', { internal_or_test_user_hostname: null })` |
| <a id="property-ip"></a> ~~`ip`~~ | `boolean` | **Deprecated** - THIS OPTION HAS NO EFFECT, kept here for backwards compatibility reasons. Use a custom transformation or "Discard IP data" project setting instead: **See** https://posthog.com/tutorials/web-redact-properties#hiding-customer-ip-address. |
| <a id="property-loaded"></a> `loaded` | (`posthog_instance`) => `void` | A function to be called once the PostHog scripts have loaded successfully. |
| <a id="property-logs"></a> `logs?` | `LogsConfig` | Logs-specific configuration options. **Default** `undefined` |
| <a id="property-mask_all_element_attributes"></a> `mask_all_element_attributes` | `boolean` | Prevent autocapture from capturing any attribute names on elements. **Default** `false` |
| <a id="property-mask_all_text"></a> `mask_all_text` | `boolean` | Prevent autocapture from capturing `textContent` on elements. **Default** `false` |
| <a id="property-mask_personal_data_properties"></a> `mask_personal_data_properties` | `boolean` | Mask personal data properties from the current URL. This will mask personal data properties such as advertising IDs (gclid, fbclid, etc.), and you can also add custom properties to mask with `custom_personal_data_properties`. **Default** `false` **See** - - Default URL parameters that are masked, including other spellings of them such as Snapchat's `ScCid`. - - Custom list of personal data properties to mask. |
| <a id="property-metrics"></a> `metrics?` | `BrowserMetricsConfig` | Metrics-specific configuration options for the posthog.metrics API. **Default** `undefined` |
| <a id="property-name-4"></a> `name` | `string` | The name this instance will be identified by. You don't need to set this most of the time, but can be useful if you have several Posthog instances running at the same time. **Default** `'posthog'` |
| <a id="property-on_request_error"></a> `on_request_error?` | (`error`) => `void` | A function that is called when a request to the PostHog API fails. |
| <a id="property-on_xhr_error"></a> ~~`on_xhr_error?`~~ | (`failedRequest`) => `void` | **Deprecated** - use `on_request_error` instead |
| <a id="property-opt_in_site_apps"></a> `opt_in_site_apps` | `boolean` | Determines if users should be opted in to site apps. **Default** `false` |
| <a id="property-opt_out_capturing_by_default"></a> `opt_out_capturing_by_default` | `boolean` | Determines if users should be opted out of PostHog tracking by default, requiring additional logic to opt them into capturing by calling `posthog.opt_in_capturing()`. **Default** `false` |
| <a id="property-opt_out_capturing_cookie_prefix"></a> ~~`opt_out_capturing_cookie_prefix`~~ | `string` \| `null` | **Deprecated** Use `consent_persistence_name` instead. This will be removed in a future major version. |
| <a id="property-opt_out_capturing_persistence_type"></a> `opt_out_capturing_persistence_type` | `"localStorage"` \| `"cookie"` | Determines where we'll save the information about whether users are opted out of capturing. **Default** `'localStorage'` |
| <a id="property-opt_out_persistence_by_default"></a> `opt_out_persistence_by_default?` | `boolean` | Determines if users should be opted out of browser data storage by this PostHog instance by default, requiring additional logic to opt them into capturing by calling `posthog.opt_in_capturing()`. **Default** `false` |
| <a id="property-opt_out_useragent_filter"></a> `opt_out_useragent_filter` | `boolean` | Determines if users should be opted out of user agent filtering such as googlebot or other bots. If this is set to `true`, PostHog will set `$browser_type` to either `bot` or `browser` for all events, but will process all events as if they were from a browser. When the filter drops events, a one-time warning is written to the console (even without debug mode). The filter applies to events only; logs sent with `captureLog` bypass it. Set this to `true` behind a test flag for end-to-end tests (Playwright, Puppeteer). **Default** `false` |
| <a id="property-override_display_language"></a> `override_display_language?` | `string` \| `null` | Display language override for Product Tours. Must be a valid BCP 47 language code. In the future this will be used for Surveys and other products that deliver in-app experiences to end-users. |
| <a id="property-persistence"></a> `persistence` | `"localStorage"` \| `"cookie"` \| `"memory"` \| `"localStorage+cookie"` \| `"sessionStorage"` | Determines how PostHog stores information about the user. See [persistence](https://posthog.com/docs/libraries/js/persistence) for details. PostHog stores the distinct ID, session ID, device ID, feature flags, super properties, and some config in the browser. - `'localStorage+cookie'` stores essential state, such as the distinct ID, device ID and session ID, in a cookie, and other data in `localStorage`. `cookie_persisted_properties` adds custom properties to the cookie. - `'cookie'` stores everything in a cookie. Cookies hold about 4KB, so many feature flags can cause `431 Request Header Fields Too Large` errors. - `'localStorage'` stores everything in `localStorage`. - `'sessionStorage'` stores everything in `sessionStorage`. - `'memory'` stores everything in page memory, so it lasts for one pageview. Call `set_config` to change the mode after `init`, for example when a user accepts cookies. **Default** `'localStorage+cookie'` |
| <a id="property-persistence_name"></a> `persistence_name` | `string` | The name for the super properties persistent store **Default** `''` |
| <a id="property-persistence_save_debounce_ms"></a> `persistence_save_debounce_ms?` | `number` | Coalesce rapid `Persistence.save()` calls into a single write. Set to a positive number (milliseconds) to debounce writes to localStorage / cookie by that window. The in-memory `props` object is always updated synchronously so within-tab reads see the latest values immediately. Cross-tab `storage` events (which carry the full persistence value as a payload) are reduced proportionally to the debounce window. Pending writes are flushed on `beforeunload` and `pagehide` so no state is lost on tab close. The cross-tab visibility delay is bounded by the configured window. Defaults to `0` (no debouncing, write synchronously) for backwards compatibility. On pages that capture many events per second, `250` is a reasonable starting point to reduce localStorage write pressure and cross-tab IPC traffic. The `2026-05-30` config default opts into `250` automatically. **Default** `0` |
| <a id="property-person_profiles"></a> `person_profiles?` | `"always"` \| `"never"` \| `"identified_only"` | You can control whether events from PostHog-js have person processing enabled with the `person_profiles` config setting. There are three options: - `person_profiles: 'always'` - we will process persons data for all events - `person_profiles: 'never'` - we won't process persons for any event. This means that anonymous users will not be merged once they sign up or login, so you lose the ability to create funnels that track users from anonymous to identified. All events (including `$identify`) will be sent with `$process_person_profile: False`. - `person_profiles: 'identified_only'` _(default)_ - we will only process persons when you call `posthog.identify`, `posthog.alias`, `posthog.setPersonProperties`, `posthog.unsetPersonProperties`, `posthog.group`, `posthog.setPersonPropertiesForFlags` or `posthog.setGroupPropertiesForFlags` Anonymous users won't get person profiles. **Default** `'identified_only'` |
| <a id="property-prepare_external_dependency_script"></a> `prepare_external_dependency_script?` | (`script`) => `HTMLScriptElement` \| `null` | A function to be called when a script is being loaded. This can be used to modify the script before it is loaded. This is useful for adding a nonce to the script, for example. |
| <a id="property-prepare_external_dependency_stylesheet"></a> `prepare_external_dependency_stylesheet?` | (`stylesheet`) => `HTMLStyleElement` \| `null` | A function to be called when a stylesheet is being loaded. This can be used to modify the stylesheet before it is loaded. This is useful for adding a nonce to the stylesheet, for example. |
| <a id="property-process_person"></a> ~~`process_person?`~~ | `"always"` \| `"never"` \| `"identified_only"` | **Deprecated** - use `person_profiles` instead |
| <a id="property-properties_string_max_length"></a> `properties_string_max_length` | `number` | Determines the maximum length of the properties string that can be sent with capture calls. **Default** `65535` |
| <a id="property-property_blacklist"></a> ~~`property_blacklist?`~~ | `string`[] | **Deprecated** - use `property_denylist` instead |
| <a id="property-property_denylist"></a> `property_denylist` | `string`[] | A list of properties that should never be sent with capture calls. **Default** `[]` |
| <a id="property-rageclick-1"></a> `rageclick` | `boolean` \| `RageclickConfig` | Determines whether PostHog should capture rage clicks. By default, rage clicks are ignored on elements that match a `ph-no-capture` or `ph-no-rageclick` CSS class on the element or a parent. When `defaults` is `'2025-11-30'` or later, the default is `{ content_ignorelist: true }`, which also ignores repeat-click controls such as pagination arrows and pagers (see `content_ignorelist`). When `defaults` is `'2026-05-30'` or later, the default also excludes stepper controls (`+`, `-`, `−`, `–`) and text-selection surfaces. **Default** `true` |
| <a id="property-rate_limiting"></a> `rate_limiting?` | `object` | Client side rate limiting. A token bucket, per browser, that stops a runaway loop on your site from flooding capture. When it drains, further `capture` calls are dropped and a one-off `$$client_ingestion_warning` is sent reporting how many events were dropped and the page and session that tripped it - usually the fastest way to find the loop. Raise these limits if you legitimately capture in bursts; a warning under the defaults is more often a bug on the page than a limit set too low. |
| `rate_limiting.events_burst_limit?` | `number` | How many events can be captured in a burst. This defaults to 10 times the events_per_second count **Default** 10 * `events_per_second` |
| `rate_limiting.events_per_second?` | `number` | The average number of events per second that should be permitted **Default** `10` |
| <a id="property-remote_config_refresh_interval_ms"></a> `remote_config_refresh_interval_ms?` | `number` | Controls how often feature flags are automatically refreshed in long-running sessions. The default interval is 5 minutes (300000ms) to pick up server-side flag changes without requiring a page reload. This is useful for SPAs and long-running tabs. An explicitly set positive interval stays fixed, even when the page gets no user interaction. **Each refresh is a billable feature flag request.** A page that stays open all day makes up to 288 requests per day on the default interval, and every open tab and every named instance refreshes on its own timer, so they add up. Set this option to `0` to stop the background refreshes if that cost is not useful to you. **Tradeoffs:** - **Shorter intervals**: Feature flag changes propagate faster, but increases network requests, cost, and server load. - **Longer intervals**: Reduces network traffic (better for mobile/battery) and cost, but flag changes take longer to propagate. - **Disabled (0 or any negative value)**: No background refreshes. Flags only update on page load or manual `reloadFeatureFlags()` calls. Use this if you control flag updates manually or have infrequent flag changes. Hidden pages skip scheduled refreshes and reload due flags when they become visible. When this option is omitted, a visible page that gets no user interaction (such as a dashboard, a page being read, a video player, or a kiosk) doubles the interval after every refresh, up to one hour. Automatic refreshes continue at that interval; they do not stop. The next click, key press, wheel, touch, or return to visibility restores the five-minute default. Scrolling driven by a script, such as an auto-playing carousel, does not count as an interaction. Set this option explicitly to keep a fixed cadence, or to `0` to stop background refreshes completely. This option does not reload remote config. **Default** `300000 (5 minutes)` |
| <a id="property-request_batching"></a> `request_batching` | `boolean` | Determines whether PostHog should batch requests to the PostHog API. **Default** `true` |
| <a id="property-request_headers"></a> `request_headers` | `object` | A list of headers that should be sent with requests to the PostHog API. **Default** `{}` |
| <a id="property-request_queue_config"></a> `request_queue_config?` | `RequestQueueConfig` | Used to change the behavior of the request queue. This is an advanced feature and should be used with caution. |
| <a id="property-require_subresource_integrity"></a> `require_subresource_integrity?` | `boolean` | Requires Subresource Integrity (SRI) for every extension script the SDK loads, such as recorder.js, surveys.js or web-vitals.js. When enabled, each extension loads only from the exact-version path `/static/<sdk version>/<name>.js` with `integrity` and `crossOrigin = 'anonymous'` set, using the SHA-384 hashes built into this SDK bundle. A missing hash, an integrity failure or a `prepare_external_dependency_script` hook that changes `integrity` or `crossOrigin` disables only that feature. The SDK never retries through the mutable legacy path, whatever strict\_script\_versioning says. The asset host, or a reverse proxy in front of it, must serve the scripts with CORS headers (`Access-Control-Allow-Origin`). This mode also disables site apps, overriding opt\_in\_site\_apps, including site app code preloaded by the token-specific `/array/<token>/array.js`. It refuses the toolbar and the executable `/array/<token>/config.js` remote config, which is then fetched as JSON. The guarantee covers the extension scripts this SDK instance inserts, anchored in the SDK code you already trust: an npm build, or an `array.js` you pin yourself. Because the extension hashes are part of `array.js`, pinning it with `data-core-integrity` on an exact-version `loader.js` that itself has an `integrity` attribute pins every extension too. The token-specific `/array/<token>/array.js` changes with project configuration, so it cannot be pinned: use `/static/<sdk version>/array.js`, the loader or npm instead. The guarantee does not cover an unpinned initial loader, third-party widgets such as Intercom or Crisp, or a malicious release with valid hashes. Extensions share page globals, so if another PostHog instance or any other code on the page already ran unverified extension code, this instance reuses it and the guarantee does not hold. **Default** `false` |
| <a id="property-respect_dnt"></a> `respect_dnt` | `boolean` | Determines whether PostHog should respect the Do Not Track header when computing consent in `ConsentManager`. **See** `ConsentManager` **Default** `false` |
| <a id="property-reuseanonymousid"></a> `reuseAnonymousId?` | `boolean` | When true, `identify()` omits `$anon_distinct_id` from the `$identify` event and the follow-up feature flag request, so PostHog does not merge the previous anonymous identity into the identified person. **Default** `false` |
| <a id="property-rewriterequestpath"></a> `rewriteRequestPath?` | (`url`) => `URL` | Rewrites the URL used for PostHog API, feature flag, and asset requests. This is intended for customers who use a reverse proxy and need custom paths. The proxy must map the rewritten paths back to the canonical PostHog paths. UI links are not rewritten. **Example** `posthog.init('phc_...', { api_host: 'https://a.example.com', rewriteRequestPath: (url) => { if (url.pathname === '/e/') { url.pathname = '/my-events/' } else if (url.pathname === '/s/') { url.pathname = '/my-replay/' } else if (url.pathname === '/flags/') { url.pathname = '/my-flags/' } return url }, })` |
| <a id="property-sanitize_properties"></a> ~~`sanitize_properties`~~ | ((`properties`, `event_name`) => `Properties`) \| `null` | **Deprecated** - use `before_send` instead |
| <a id="property-save_campaign_params"></a> `save_campaign_params` | `boolean` | Determines whether PostHog should save marketing parameters. These are `utm_*` paramaters and friends. **See** from './utils/event-utils' - Default campaign parameters like utm_source, utm_medium, etc. **Default** `true` |
| <a id="property-save_referrer"></a> `save_referrer` | `boolean` | Determines whether PostHog should save referrer information. **Default** `true` |
| <a id="property-scroll_root_selector"></a> `scroll_root_selector?` | `string` \| `string`[] | Let the pageview scroll stats use a custom css selector for the root element, e.g. `main` It will use `window.document.documentElement` if not specified. |
| <a id="property-secure_cookie"></a> `secure_cookie` | `boolean` | Determines whether PostHog should use secure cookies. If this is `true`, PostHog cookies will be marked as secure, meaning they will only be transmitted over HTTPS. **Default** `window.location.protocol === 'https:'` |
| <a id="property-segment"></a> `segment?` | `SegmentIntegrationConfig` \| `SegmentAnalytics` | The Segment analytics object, or integration configuration. **Example** `segment: { analytics: window.analytics, filterProperties: (properties) => { for (const key in properties) { if (key.startsWith('$sdk_debug_')) { delete properties[key] } } return properties } }` **See** https://posthog.com/docs/libraries/segment |
| <a id="property-session_idle_timeout_seconds"></a> `session_idle_timeout_seconds` | `number` | Determines the session idle timeout in seconds. If no events are captured for this many seconds, the next event starts a new session with a new `$session_id` (and `$window_id`). The SDK may also proactively reset the stored session after the timeout while the page is idle, so the next event creates a new session. Session recording has a separate idle threshold: `session_recording.session_idle_threshold_ms`. That setting only controls when the user is considered idle, it does not rotate `$session_id`. Must be between 60 seconds and 10 hours. Values outside this range are clamped. **Default** `30 * 60 -- 30 minutes` |
| <a id="property-session_recording"></a> `session_recording` | `SessionRecordingOptions` | Determines the session recording options. For more session recording settings, see the `enable_recording_console_log` and `capture_performance` configuration option. When `defaults` is `'2025-11-30'` or later, `strictMinimumDuration` defaults to `true`. **See** `SessionRecordingOptions` **Default** `{}` |
| <a id="property-split_storage"></a> `split_storage?` | `boolean` | Store the feature-flag config cluster and survey config in their own localStorage entries (`<name>__flags`, `<name>__surveys`) instead of the single main persistence blob. These payloads are large and change rarely, so keeping them out of the main blob stops them riding on every high-frequency main-blob write and broadcasting cross-tab `storage` events. Only applies when persistence resolves to `localStorage` / `localStorage+cookie` (the split is pointless for `memory` / `sessionStorage` and impossible for `cookie`). On load the old main-blob location is read once and migrated forward, so upgrades never miss a cached flag. The `2026-05-30` config default opts in. **Default** `false` |
| <a id="property-store_google"></a> ~~`store_google?`~~ | `boolean` | **Deprecated** - Use `save_campaign_params` instead |
| <a id="property-strict_script_versioning"></a> `strict_script_versioning` | `boolean` \| `"fallback"` | Determines whether PostHog should load external dependency scripts from semver-qualified asset paths such as /static/1.370.0/recorder.js instead of the legacy /static/recorder.js?v=1.370.0 form. Set to `true` to use only versioned paths, `false` to use only legacy paths, or `'fallback'` to try the versioned path first and retry with the legacy path if it fails. **Default** `'fallback'` |
| <a id="property-surveys"></a> `surveys?` | `SurveyConfig` | Survey-specific configuration options. **Default** `undefined` |
| <a id="property-surveys_request_timeout_ms"></a> `surveys_request_timeout_ms` | `number` | Sets timeout for fetching surveys **Default** `10000` |
| <a id="property-token"></a> `token` | `string` | The token for your PostHog project. It should NOT be provided manually in the config, but rather passed as the first parameter to `posthog.init()`. |
| <a id="property-trace_propagation_targets"></a> `trace_propagation_targets?` | `string`[] | Hosts that should receive a W3C Trace Context `traceparent` header on `fetch` and `XMLHttpRequest` requests, so your backend can continue the trace started in the browser. Each request gets a new trace id and span id, with the sampled flag set (`00-<trace-id>-<span-id>-01`). The browser does not record a span of its own, so the span id in the header is the parent of your server's root span. Matching is exact and nothing is sent to unlisted hosts: - an entry with a scheme (`https://api.example.com`, `http://localhost:8000`) matches that origin only - any other entry (`api.example.com`) matches that hostname on any scheme or port Only list hosts that accept the header. A cross-origin request with a `traceparent` header triggers a CORS preflight, and fails if the server's `Access-Control-Allow-Headers` doesn't include `traceparent`. A `traceparent` header already set by your app or by OpenTelemetry's instrumentation is never overwritten or duplicated. If OpenTelemetry's XHR instrumentation also propagates to a cross-origin host (its `propagateTraceHeaderCorsUrls`), list that host in only one of the two. **Example** `posthog.init('<token>', { trace_propagation_targets: ['https://api.example.com', 'internal.example.com'] })` |
| <a id="property-tracing_headers"></a> `tracing_headers?` | `string`[] | A list of hostnames for which to inject PostHog tracing headers to all requests (X-POSTHOG-DISTINCT-ID, X-POSTHOG-SESSION-ID, X-POSTHOG-WINDOW-ID). Used to link frontend sessions to backend traces (see https://posthog.com/docs/llm-analytics/link-session-replay). |
| <a id="property-ui_host"></a> `ui_host` | `string` \| `null` | If using a reverse proxy for `api_host` then this should be the actual PostHog app URL (e.g. https://us.posthog.com). This ensures that links to PostHog point to the correct host. **Default** `null` |
| <a id="property-upgrade"></a> `upgrade` | `boolean` | Determines whether PostHog should upgrade old cookies. If set to `true`, the library will check for a cookie from our old js library and import super properties from it, then the old cookie is deleted. This option only works in the initialization, so make sure you set it when you create the library. **Default** `false` |
| <a id="property-verbose"></a> ~~`verbose?`~~ | `boolean` | **Deprecated** Use `debug` instead |
| <a id="property-xhr_headers"></a> ~~`xhr_headers?`~~ | `object` | **Deprecated** - use `request_headers` instead |

### `ProductTourBannerConfig`

| Property | Type |
| ------ | ------ |
| <a id="property-action"></a> `action?` | `object` |
| `action.link?` | `string` |
| `action.tourId?` | `string` |
| `action.type` | `"none"` \| `"link"` \| `"trigger_tour"` |
| <a id="property-animation"></a> `animation?` | `object` |
| `animation.duration?` | `number` |
| <a id="property-behavior"></a> `behavior` | `"sticky"` \| `"static"` \| `"custom"` |
| <a id="property-selector-2"></a> `selector?` | `string` |

### `RageclickConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-click_count"></a> `click_count?` | `number` | Number of consecutive clicks within the timeout to qualify as a rage click. **Default** `3` |
| <a id="property-content_ignorelist"></a> `content_ignorelist?` | `boolean` \| `string`[] | Controls automatic exclusion of elements by text content from rageclick detection. Useful for pagination buttons and other repeatedly-clicked UI elements. - `true`: Use the default keywords, which cover next/previous/prev wording and arrow glyphs such as '>', '<', '→', '←', '»', '«' - `false`: Disable content-based exclusion - `string[]`: Use custom keywords (max 29 items, otherwise use css_selector_ignorelist) Checks the text and aria-label of the clicked control (the nearest button, link or other interactive ancestor) against the keywords, case-insensitive. The label of a surrounding region is not checked, so a labelled wrapper does not suppress the controls inside it. The built-in word keywords (next/previous/prev/etc.) match whole words wherever they appear, even inside a list you pass yourself, so 'prev' doesn't suppress "Preview". Any other word keyword you add matches as a substring. Symbol-only keywords (e.g. '+', '-', '>') always match exactly, so they don't suppress text like "sign-up", "5 > 3", or "C++". Below the `'2025-11-30'` defaults, and in any `set_config` call, a `rageclick` object you pass replaces the default instead of merging with it, so set this property explicitly there to keep content filtering. **Default** undefined (`true` when `defaults` is `'2025-11-30'` or later; the default keywords plus the '+', '-', '−', '–' steppers when `defaults` is `'2026-05-30'` or later) |
| <a id="property-css_selector_ignorelist-1"></a> `css_selector_ignorelist?` | `string`[] | List of CSS selectors to ignore rageclicks on e.g. ['.my-calendar-button'] we consider the tree of elements from the root to the target element of the click event so for the tree div > div > button > svg and ignore list config `['[id]']` we will ignore the rageclick if the click-target or its parents has any id Nothing is ignored when there's an empty ignorelist, e.g. [] If no ignorelist is set, we default to ignoring .ph-no-rageclick If an element has .ph-no-capture, it will always be ignored by rageclick and autocapture |
| <a id="property-ignore_text_selection"></a> `ignore_text_selection?` | `boolean` | Excludes text-editing surfaces (textarea, text-like inputs, and contenteditable elements) from rageclick detection, since rapid repeated clicks there are double/triple-click text selection rather than rage. Enabled by default from the 2026-05-30 config defaults onwards. **Default** `false` |
| <a id="property-threshold_px"></a> `threshold_px?` | `number` | Maximum pixel distance between clicks to still be considered a rage click. **Default** `30` |
| <a id="property-timeout_ms"></a> `timeout_ms?` | `number` | Maximum time window (in milliseconds) between the first and last click. **Default** `1000` |

### `RemoteConfig`

Remote configuration for a PostHog browser client.

These settings can be configured in PostHog. Configuration set directly on
the client takes precedence over values from the server.

#### Extended by

- `FlagsResponse`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-analytics-1"></a> `analytics?` | `object` | Custom endpoint configuration for analytics events. |
| `analytics.endpoint?` | `string` | - |
| <a id="property-autocapture_opt_out-1"></a> `autocapture_opt_out?` | `boolean` | If true, disables autocapture. When absent or not a boolean, the SDK keeps the last known server value; a visitor with no stored value keeps autocapture off until a response containing the field arrives. |
| <a id="property-autocaptureexceptions-1"></a> `autocaptureExceptions?` | `boolean` \| \{ `endpoint?`: `string`; \} | Exception autocapture configuration. |
| <a id="property-capturedeadclicks-1"></a> `captureDeadClicks?` | `boolean` | Whether to capture dead clicks. |
| <a id="property-captureperformance-1"></a> `capturePerformance?` | `boolean` \| `PerformanceCaptureConfig` | Performance capture configuration shared by replay and web vitals. |
| <a id="property-conversations-1"></a> `conversations?` | `boolean` \| `ConversationsRemoteConfig` | Conversations widget configuration. |
| <a id="property-defaultidentifiedonly-1"></a> `defaultIdentifiedOnly?` | `boolean` | Whether to capture only identified users by default. |
| <a id="property-editorparams-1"></a> ~~`editorParams?`~~ | `ToolbarParams` | **Deprecated** Renamed to `toolbarParams`; still present on older API responses. |
| <a id="property-elementschainasstring-1"></a> `elementsChainAsString?` | `boolean` | Whether `$elements_chain` is sent as a string rather than an array. |
| <a id="property-errortracking-1"></a> `errorTracking?` | `object` | Error tracking configuration. |
| `errorTracking.autocaptureExceptions?` | `boolean` | - |
| `errorTracking.captureExtensionExceptions?` | `boolean` | - |
| `errorTracking.suppressionRules?` | `ErrorTrackingSuppressionRule`[] | - |
| <a id="property-hasfeatureflags-1"></a> `hasFeatureFlags?` | `boolean` | Whether the team has any feature flags enabled. |
| <a id="property-heatmaps-1"></a> `heatmaps?` | `boolean` | Whether heatmaps are enabled. |
| <a id="property-isauthenticated-1"></a> `isAuthenticated` | `boolean` | Whether the current user is authenticated. |
| <a id="property-logs-1"></a> `logs?` | `object` | Log capture configuration. |
| `logs.captureConsoleLogs?` | `boolean` | - |
| <a id="property-producttours-1"></a> `productTours?` | `boolean` | Whether product tours are enabled. |
| <a id="property-sessionrecording-1"></a> `sessionRecording?` | `false` \| `SessionRecordingRemoteConfig` | Session recording configuration. |
| <a id="property-siteapps-1"></a> `siteApps` | `object`[] | Site apps available to the client. |
| <a id="property-supportedcompression-1"></a> `supportedCompression` | `Compression`[] | Supported compression algorithms. |
| <a id="property-surveys-1"></a> `surveys?` | `boolean` \| `Survey`[] | Whether surveys are enabled, optionally including their definitions. |
| <a id="property-toolbarparams-1"></a> `toolbarParams` | `ToolbarParams` | Parameters for the toolbar. |
| <a id="property-toolbarversion-1"></a> ~~`toolbarVersion`~~ | `"toolbar"` | **Deprecated** Moved to `toolbarParams`. |

### `RequestQueueConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-flush_interval_ms"></a> `flush_interval_ms?` | `number` | ADVANCED - alters the frequency which PostHog sends events to the server. generally speaking this is only set when apps have automatic page refreshes, or very short visits. Defaults to 3 seconds when not set Allowed values between 250 and 5000 |

### `SegmentIntegrationConfig`

> **SegmentIntegrationConfig** = `object`

Configuration for the PostHog Segment integration.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="analytics"></a> `analytics` | `SegmentAnalytics` | The Segment analytics object. |
| <a id="filterproperties"></a> `filterProperties?` | `SegmentEnrichmentFilterFn` \| `SegmentEnrichmentFilterFn`[] | A function or array of functions called with the properties generated by PostHog before they are added to a Segment event. Return the properties to add, or `null` to leave the original Segment event unenriched. Original Segment properties are not passed to these functions. They are merged afterward and take precedence over properties returned by this hook. If a function throws, the original Segment event is left unchanged. |

### `SessionRecordingOptions`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-__mutationbytesbucketsize"></a> `__mutationBytesBucketSize?` | `number` | ADVANCED: enables the mutation byte budget by setting its burst allowance, in bytes. Also the largest single mutation event that will be recorded. Unset (the default), the byte budget is off. 1048576 (1MB) is a sensible starting point. Normally only altered alongside posthog support guidance. **Default** `undefined` |
| <a id="property-__mutationbytesrefillrate"></a> `__mutationBytesRefillRate?` | `number` | ADVANCED: the sustained mutation byte budget, in bytes per second. Mutation events beyond the budget are dropped and the recording resyncs with a full snapshot. Only takes effect when `__mutationBytesBucketSize` is set. Normally only altered alongside posthog support guidance. **Default** `25600` |
| <a id="property-__mutationthrottlerbucketsize"></a> `__mutationThrottlerBucketSize?` | `number` | ADVANCED: alters the bucket size for the token bucket mutation throttling Normally only altered alongside posthog support guidance. Accepts values between 0 and 100 **Default** `100` |
| <a id="property-__mutationthrottlerrefillrate"></a> `__mutationThrottlerRefillRate?` | `number` | ADVANCED: alters the refill rate for the token bucket mutation throttling Normally only altered alongside posthog support guidance. Accepts values between 0 and 100 **Default** `10` |
| <a id="property-attributefilter"></a> `attributeFilter?` | `string`[] | ADVANCED: limit which DOM attributes are observed for mutations, by passing the list to the native `MutationObserver` `attributeFilter`. Mutations to unlisted attributes never reach the recorder at all, so they cost no recording CPU - useful to exclude high-frequency inline `style` mutations from JS-driven animations on animation-heavy pages. Attributes left off the list are invisible to replay, so only set this when that loss of fidelity is acceptable. When unset (the default) or set to an empty array, all attributes are observed. A list without `id` also stops `captureJsonLd` from keeping `@id` fragments. Normally only altered alongside posthog support guidance. |
| <a id="property-blockclass"></a> `blockClass?` | `string` \| `RegExp` | Derived from `rrweb.record` options **See** **Default** `'ph-no-capture'` |
| <a id="property-blockselector"></a> `blockSelector?` | `string` \| `null` | Derived from `rrweb.record` options **See** **Default** `null` |
| <a id="property-canvascapture"></a> `canvasCapture?` | `object` | Tune how canvas frames are captured for replay. Only has any effect when canvas recording is enabled. - `resolutionScale`: capture canvas frames at a fraction of their display resolution. A number in `(0, 1]`; `1` is full-resolution capture (the default) and, e.g., `0.6` captures at 60%. Out-of-range or non-finite values are clamped into `(0, 1]`. Aspect ratio is preserved and replay upscales the frame back to the original display size, so playback dimensions are unchanged, just softer. Resolution is the highest-leverage lever for canvas byte size, since bytes scale with pixel area. - `maskRegionsFn`: mask regions of a recorded canvas — see its doc comment. |
| `canvasCapture.maskRegionsFn?` | ((`canvas`) => `CanvasMaskRegion`[] \| `null` \| `undefined`) \| `null` | If set, called once per canvas per captured frame; the returned regions (CSS pixels, relative to the canvas element) are painted black before the frame is encoded. Lets apps that render into canvas (e.g. Flutter web) mask content that DOM-based masking cannot see. Re-read from config on every frame, so the real provider can be swapped in after recording has started. Return `[]` for a frame with nothing to mask (recorded as is), or `null` if regions could not be computed — that frame is skipped rather than recorded unmasked. Anything other than an array — `null`, a thrown error, or an implicit `undefined` from an untyped caller — skips that frame. Not setting this at all records the canvas unmasked. The provider is called for every canvas on the page, including canvases inside shadow DOM. For a canvas it does not manage, return `[]` ("nothing to mask") — returning `null` skips that canvas's frames entirely. Called synchronously on the main thread for every captured frame (canvas FPS is 4 by default, 12 max), so keep it cheap — avoid forcing layout, and return few regions. Setting this also changes DOM full snapshots (taken at recording start and at each `full_snapshot_interval_millis`): they normally serialize canvas pixels on a separate path (`rr_dataURL`) that never sees these regions, so when this option is set that serialization is skipped entirely. Whether to skip is re-evaluated at each snapshot, so a provider installed via `set_config` after recording started is honored at the next snapshot without a recorder restart. A canvas appears blank in a snapshot until the next canvas frame paints it — ~250ms at the default 4 fps while its pixels are changing, and at most 30s otherwise, because every canvas the provider answers (with regions or `[]`) re-sends an unchanged frame as a keyframe every 30s; a canvas whose frames are skipped (`null`) stays blank. Without this option, snapshot behavior is unchanged. An app whose real provider only exists once its runtime has booted picks what happens in between by what it declares in `posthog.init`: a function covering the whole canvas blacks those frames out, `() => null` skips them, and declaring nothing records them. Client-side only, cannot be set via remote configuration. **Default** `undefined` |
| `canvasCapture.resolutionScale?` | `number` | - |
| <a id="property-capturecanvas"></a> `captureCanvas?` | `SessionRecordingCanvasOptions` | Allows local config to override remote canvas recording settings from the flags response. To mask content inside a recorded canvas, see `canvasCapture.maskRegionsFn`. |
| <a id="property-capturejsonld"></a> `captureJsonLd?` | `boolean` | Captures sanitized Schema.org JSON-LD as session replay custom events. JSON-LD inside a text mask or blocked element is never captured. The recorder keeps properties on its universal safe list at every depth. This list includes `@type` values shaped like a Schema.org term, which means letters and digits only. It drops property branches that are not on the allowlist. Retained strings starting with `http://`, `https://`, `//`, `/`, `./`, or `../` use replay URL masking, including query parameter and hash settings. This applies to nested entities and scalar arrays, but not to the fixed `@context`, normalized `@type`, or captured DOM IDs. Other strings, including bare relative paths and URLs embedded in text, are unchanged. A URL rejected by the masking callback is omitted. If the callback throws, the script is not captured. It keeps an `@id` as a fragment only when replay also captures a DOM element with the same `id` value. It drops every `@id` when `maskAllElementAttributes`, `maskAttributeFn`, or an `attributeFilter` without `id` can hide `id` attributes from replay. It also keeps the containing entity tree, even when it redacts all other fields. The event tag is `$json_ld`. The payload is a JSON-LD object or array. The event includes the current page URL in `data.href`, subject to replay URL masking and hash capture settings. The URL is omitted when the masking callback rejects it or throws. The recorder removes all script nodes from snapshots when this option is enabled. The JSON-LD observer starts only when this option is true at recording start. **See** https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/extensions/replay/external/json-ld.ts **Default** false before the `2026-08-30` defaults, otherwise true |
| <a id="property-collectfonts"></a> `collectFonts?` | `boolean` | Derived from `rrweb.record` options **See** **Default** `false` |
| <a id="property-compress_events"></a> `compress_events?` | `boolean` | ADVANCED: whether to partially compress rrweb events before sending them to the server, defaults to true, can be set to false to disable partial compression NB requests are still compressed when sent to the server regardless of this setting **Default** `true` |
| <a id="property-full_snapshot_interval_millis"></a> `full_snapshot_interval_millis?` | `number` | ADVANCED: while a user is active we take a full snapshot of the browser every interval. For very few sites playback performance might be better with different interval. Set to 0 to disable **Default** `1000 * 60 * 5 (5 minutes)` |
| <a id="property-ignoreclass"></a> `ignoreClass?` | `string` \| `RegExp` | Derived from `rrweb.record` options **See** **Default** `'ph-ignore-input'` |
| <a id="property-inlinestylesheet"></a> `inlineStylesheet?` | `boolean` | Derived from `rrweb.record` options **See** **Default** `true` |
| <a id="property-inlinestylesheetbudgetrules"></a> `inlineStylesheetBudgetRules?` | `number` | Max CSSRules inlined synchronously per full snapshot. Sheets past the budget keep their `rel`/`href` and are inlined across idle callbacks instead of blocking the snapshot; the queue is flushed synchronously (bounded) when recording stops and on `pagehide`. The residual risk: replay falls back to loading a sheet from its original href (which may be purged, auth-gated, or renamed by replay time) only if the tab dies without `pagehide` firing, the teardown flush hits its safety cap, or stringifying the sheet fails. The default is applied by posthog-js when it starts the recorder; the recorder itself is unbounded without it. Set 0 to inline everything up front (the pre-budget behaviour). **Default** `10000` |
| <a id="property-maskallelementattributes"></a> `maskAllElementAttributes?` | `boolean` | Derived from `rrweb.record` options. Masks every string-valued source DOM attribute, including rendering attributes such as `class`, `id`, `style`, `src`, `href`, and synthesized form values. Only rrweb-generated layout metadata is retained, so this option intentionally reduces replay fidelity. Mutually exclusive with `maskAttributeFn`: when both are set this option wins and the callback is ignored. **See** **Default** `false` |
| <a id="property-maskallinputs"></a> `maskAllInputs?` | `boolean` | Derived from `rrweb.record` options. When `true` (the default) session replay masks the value of every input, except `file` inputs, whose values are recorded unmasked — block those with `ph-no-capture` or `blockSelector` if they hold sensitive data. Set it to `false` to record input values, which is not recommended for apps that handle sensitive data. A `session_recording` masking option set in `posthog.init` takes precedence over the project "Privacy and masking" setting; the SDK warns once when the two differ. **See** - - https://posthog.com/docs/session-replay/privacy **Default** `true` |
| <a id="property-maskattributefn"></a> `maskAttributeFn?` | ((`name`, `value`, `element?`) => `string`) \| `null` | Derived from `rrweb.record` options. Called with `(name, value, element)` for every non-empty string-valued attribute in the final serialized representation so you can mask specific attributes. Returning the original value leaves it visible. Mutually exclusive with `maskAllElementAttributes`: when both are set that option wins and this callback is ignored, so a callback cannot accidentally unmask what the coarse option hides. **See** |
| <a id="property-maskcapturednetworkrequestfn"></a> `maskCapturedNetworkRequestFn?` | ((`data`) => `CapturedNetworkRequest` \| `null` \| `undefined`) \| `null` | Modify the network request before it is captured. Returning null or undefined stops it being captured. Initial navigation and performance-timing entries are also passed to this function. They have `isInitial === true`, can have `method === undefined`, and contain the page URL in `name`. If the function returns null or undefined for an initial entry, PostHog retains the replay-required timing metadata but omits its URL, headers, and body. Return a modified entry to retain a redacted URL. |
| <a id="property-maskinputfn"></a> `maskInputFn?` | ((`text`, `element?`) => `string`) \| `null` | Derived from `rrweb.record` options **See** |
| <a id="property-maskinputoptions"></a> `maskInputOptions?` | `Partial`\<`MaskInputOptions`\> | Derived from `rrweb.record` options. Selects which input types to mask by input attribute, for use when `maskAllInputs` is `false`. Password inputs are always masked by default: the SDK adds `password: true` to a partial override, so set `password: false` explicitly if you must record password fields. **See** - - https://posthog.com/docs/session-replay/privacy |
| <a id="property-masknetworkrequestfn"></a> ~~`maskNetworkRequestFn?`~~ | ((`data`) => `NetworkRequest` \| `null` \| `undefined`) \| `null` | **Deprecated** - use maskCapturedNetworkRequestFn instead |
| <a id="property-masktextclass"></a> `maskTextClass?` | `string` \| `RegExp` | Derived from `rrweb.record` options **See** **Default** `'ph-mask'` |
| <a id="property-masktextfn"></a> `maskTextFn?` | ((`text`, `element?`) => `string`) \| `null` | Derived from `rrweb.record` options **See** |
| <a id="property-masktextselector"></a> `maskTextSelector?` | `string` \| `null` | Derived from `rrweb.record` options. A CSS selector for non-input text to mask in session replay. Session replay masks input values by default (see `maskAllInputs`), but it does not mask other DOM text or images. This selector and the `ph-mask` class mask text content only — for example a rendered card number — and do not hide an image, whose `src` is still recorded. To redact a rendered image such as a scanned document, block the image or a container element with `ph-no-capture` (see `blockClass`/`blockSelector`), which replaces it with a placeholder and stops recording its subtree. **See** - - https://posthog.com/docs/session-replay/privacy |
| <a id="property-recordbody"></a> `recordBody?` | `boolean` | Derived from `rrweb.record` options **See** **Default** `false` |
| <a id="property-recordcrossoriginiframes"></a> `recordCrossOriginIframes?` | `boolean` | Derived from `rrweb.record` options **See** **Default** `false` |
| <a id="property-recordheaders"></a> `recordHeaders?` | `boolean` | Derived from `rrweb.record` options **See** **Default** `false` |
| <a id="property-samplerate"></a> `sampleRate?` | `number` | The sample rate for session recordings, a number between 0 and 1. For example, 0.5 means roughly 50% of sessions will be recorded. When `undefined`, falls back to the remote config setting. When set, takes precedence over the remote config. **Default** `undefined` |
| <a id="property-sampling"></a> `sampling?` | `SessionRecordingSamplingConfig` | Derived from `rrweb.record` options. Controls how often certain event types are captured within an already-recorded session, e.g. `{ mousemove: false }` stops recording mouse movement. Not to be confused with `sampleRate` below, which controls whether a session is recorded at all, or with `posthog.startSessionRecording({ sampling: true })`, which overrides that session-level sample rate. NB disabled event types no longer count as user activity for replay idle detection (`session_idle_threshold_ms`). For example, with `mousemove: false` pure mouse movement no longer keeps a session active, while clicks, scrolls, and inputs still do. **See** **Default** `undefined` |
| <a id="property-selectmaskingfn"></a> `selectMaskingFn?` | (`element`) => `"masked"` \| `"unmasked"` | Opt in to explicit select selection masking, overriding the select category setting. Masked selects use `maskInputFn` for replacement text but omit selection identity metadata. Returning original text from `maskInputFn` still records that text, even when this policy returns 'masked'. The callback is responsible for sanitizing its output. Unmasked selects retain their choices, including duplicate-valued options. Masked native `<selectedcontent>` clones are omitted. Static option labels remain visible. Pointer events are not covered: clicks on options in listbox-style selects (`multiple`, `size` > 1 or a customizable picker) still record the clicked option and position. Block selects whose choices must stay private, for example with `ph-no-capture`. Omit this option to preserve legacy `maskInputFn` behavior. Use a pure policy. It is evaluated for input events, select subtree mutations and snapshots; changes to external state take effect at the next such capture. Keep the callback reference stable. Replacing it restarts recording and discards queued old-policy data; changing its return value does not require a restart. Pending buffers are not carried across page loads with this option, because callback compatibility cannot be verified across pages. Invalid return values and exceptions resolve to masked. Recording does not start if the loaded recorder or driver does not support this option. Policy transitions also require a matching replay player. |
| <a id="property-session_idle_threshold_ms"></a> `session_idle_threshold_ms?` | `number` | ADVANCED: Controls when session recording considers the user idle. If no replay user interaction occurs for this many milliseconds, the recorder marks the recording idle, emits a `sessionIdle` replay marker, flushes buffered replay events, and drops most subsequent replay events until user activity resumes. If activity resumes before `session_idle_timeout_seconds`, recording continues under the same `$session_id`. This does not control `$session_id` rotation. Session rotation is controlled by `session_idle_timeout_seconds`, so this value should be lower than `session_idle_timeout_seconds * 1000`. **Default** `1000 * 60 * 5 (5 minutes)` |
| <a id="property-slimdomoptions"></a> `slimDOMOptions?` | `true` \| `Partial`\<`SlimDOMOptions`\> \| `"all"` | Derived from `rrweb.record` options **See** **Default** `{}` |
| <a id="property-streamnetworkbody"></a> `streamNetworkBody?` | `boolean` | When recording network bodies, read them through a streaming reader that stops at the payload size limit instead of buffering the whole body and then discarding it. Bounds the memory and pre-request latency of capturing a very large body. Reads only a clone of the body, never the stream the page consumes. **Default** `false` |
| <a id="property-strictminimumduration"></a> `strictMinimumDuration?` | `boolean` | When true, minimum duration is checked against the actual buffer data (first to last timestamp) rather than session duration. This ensures recordings are not sent until they contain the minimum duration of actual data, even across page navigations. **Default** `false` |
| <a id="property-trigger_pending_buffer_interval_millis"></a> `trigger_pending_buffer_interval_millis?` | `number` | ADVANCED: controls how much recent replay data is kept in memory while session recording waits for a conditional trigger. The recorder periodically takes a full snapshot and discards older buffered events, so increasing this interval retains more pre-trigger history but can increase memory usage and CPU usage. Performance impacts on your site can start to be visible to users with larger values. Values must be between 1,000 ms and 3,600,000 ms (1 hour, inclusive); values outside this range, or non-finite values, are ignored. **Default** `1000 * 60 (1 minute)` |

### `SessionRecordingPersistedConfig`

> **SessionRecordingPersistedConfig** = `Omit`\<`SessionRecordingRemoteConfig`, `"recordCanvas"` \| `"canvasFps"` \| `"canvasQuality"` \| `"networkPayloadCapture"` \| `"sampleRate"` \| `"minimumDurationMilliseconds"`\> & `object`

the config stored in persistence when session recording remote config is received

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `cache_timestamp?` | `number` | Used to determine if the persisted config is still valid or we need to wait for a new one only accepts undefined since older versions of the library didn't set this. |
| `canvasRecording` | `object` | - |
| `canvasRecording.enabled` | `SessionRecordingRemoteConfig`\[`"recordCanvas"`\] | - |
| `canvasRecording.fps` | `SessionRecordingRemoteConfig`\[`"canvasFps"`\] | - |
| `canvasRecording.quality` | `SessionRecordingRemoteConfig`\[`"canvasQuality"`\] | - |
| `enabled` | `boolean` | - |
| `minimumDurationMilliseconds` | `number` \| `null` \| `undefined` | - |
| `networkPayloadCapture` | `SessionRecordingRemoteConfig`\[`"networkPayloadCapture"`\] & `object` | - |
| `sampleRate` | `number` \| `null` | - |

### `SessionRecordingRemoteConfig`

> **SessionRecordingRemoteConfig** = `SessionRecordingCanvasOptions` & `object`

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `consoleLogRecordingEnabled?` | `boolean` | - |
| `endpoint?` | `string` | - |
| `eventTriggers?` | `string`[] | - |
| `linkedFlag?` | `string` \| `FlagVariant` \| `null` | - |
| `masking?` | `Pick`\<`SessionRecordingOptions`, `"maskAllInputs"` \| `"maskTextSelector"` \| `"blockSelector"` \| `"maskAllElementAttributes"`\> | - |
| `minimumDurationMilliseconds?` | `number` | - |
| `networkPayloadCapture?` | `Pick`\<`NetworkRecordOptions`, `"recordBody"` \| `"recordHeaders"`\> | - |
| `sampleRate?` | `string` \| `null` | - |
| `scriptConfig?` | `object` | - |
| `scriptConfig.script?` | `string` | - |
| `triggerGroups?` | `SessionRecordingTriggerGroup`[] | V2 Trigger Groups - multiple named trigger groups with their own conditions and sample rates. Only used when version === 2. |
| `triggerMatchType?` | `"any"` \| `"all"` | Controls how event, URL, sampling, and linked flag triggers are combined. `any` means that if any of the triggers match, the session will be recorded. `all` means that all the triggers must match for the session to be recorded. |
| `urlBlocklist?` | `SessionRecordingUrlTrigger`[] | - |
| `urlTriggers?` | `SessionRecordingUrlTrigger`[] | - |
| `version?` | `1` \| `2` | Config version - defaults to 1 (legacy). When version is 2, triggerGroups is used instead of individual trigger fields. |

### `SessionRecordingSamplingConfig`

Sampling options for session recording, a subset of rrweb's sampling strategy

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-mouseinteraction"></a> `mouseInteraction?` | `boolean` | When `false`, disables capture of mouse interaction events (click, mouse up/down, hover, and touch start/end). NB replays will not show clicks when this is disabled. **Default** `undefined` |
| <a id="property-mousemove"></a> `mousemove?` | `number` \| `boolean` | Controls capture of mouse movement within a recorded session. `false` disables capture entirely; NB this also disables touchmove and drag capture. A number throttles capture so that positions are captured at most once every N milliseconds. When `undefined` (or `true`), rrweb's default applies: capture throttled to every 50ms. **Default** `undefined` |

### `SurveyConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-autosubmitdelay"></a> ~~`autoSubmitDelay?`~~ | `number` | **Deprecated** No longer used. Pre-filled responses are now sent immediately when partial responses are enabled, or all required questions have been pre-filled. |
| <a id="property-autosubmitifcomplete"></a> ~~`autoSubmitIfComplete?`~~ | `boolean` | **Deprecated** No longer used. Surveys will automatically advance past prefilled questions with skipSubmitButton enabled. If partial response collection is enabled, partial responses for pre-filled questions will be submitted automatically on page load. |
| <a id="property-prefillfromurl"></a> `prefillFromUrl?` | `boolean` | Prefill survey responses from matching URL parameters. **Default** `undefined` |

### `SurveyConfig`

Survey configuration options

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-autosubmitdelay"></a> `autoSubmitDelay?` | `number` |
| <a id="property-autosubmitifcomplete"></a> `autoSubmitIfComplete?` | `boolean` |
| <a id="property-prefillfromurl"></a> `prefillFromUrl?` | `boolean` |

### `WebMCPCaptureConfig`

Selects the WebMCP metadata that PostHog captures.
Options are applied when a tool registers. Re-register a tool after changing these options.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-intent"></a> `intent?` | `boolean` | Captures the agent's reason for the tool call. Enabled by default. |
| <a id="property-model"></a> `model?` | `boolean` | Captures the model identifier that the agent reports. Enabled by default. |
