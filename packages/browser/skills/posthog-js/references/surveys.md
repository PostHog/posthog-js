# Surveys

## Surveys

### `PostHog.cancelPendingSurvey`

> **cancelPendingSurvey**(`surveyId`): `void`

Cancels a pending survey that is waiting to be displayed (e.g., due to a popup delay).

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `surveyId` | `string` | The survey ID whose pending display should be cancelled. |

#### Returns

`void`

### `PostHog.canRenderSurvey`

> **canRenderSurvey**(`surveyId`): `SurveyRenderReason` \| `null`

Checks the feature flags associated with this Survey to see if the survey can be rendered.
This method is deprecated because it's synchronous and won't return the correct result if surveys are not loaded.
Use `canRenderSurveyAsync` instead.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `surveyId` | `string` | The ID of the survey to check. |

#### Returns

`SurveyRenderReason` \| `null`

A SurveyRenderReason object indicating if the survey can be rendered.

#### Deprecated

### `PostHog.canRenderSurveyAsync`

> **canRenderSurveyAsync**(`surveyId`, `forceReload?`): `Promise`\<`SurveyRenderReason`\>

Checks the feature flags associated with this Survey to see if the survey can be rendered.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `surveyId` | `string` | `undefined` | The ID of the survey to check. |
| `forceReload?` | `boolean` | `false` | If true, the survey will be reloaded from the server, Default: false |

#### Returns

`Promise`\<`SurveyRenderReason`\>

A SurveyRenderReason object indicating if the survey can be rendered.

#### Example

```js
posthog.canRenderSurveyAsync(surveyId).then((result) => {
    if (result.visible) {
        // Survey can be rendered
        console.log('Survey can be rendered')
    } else {
        // Survey cannot be rendered
        console.log('Survey cannot be rendered:', result.disabledReason)
    }
})
```

### `PostHog.displaySurvey`

> **displaySurvey**(`surveyId`, `options?`): `void`

Display a survey programmatically as either a popover or inline element.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `surveyId` | `string` | `undefined` | The survey ID to display. |
| `options?` | `DisplaySurveyOptions` | `DEFAULT_DISPLAY_SURVEY_OPTIONS` | Display configuration. Defaults to a popover that respects dashboard conditions and delays. |

#### Returns

`void`

#### Examples

```js
// Display as popover (respects all conditions defined in the dashboard)
posthog.displaySurvey('survey-id-123')
```

```js
// Display inline in a specific element
posthog.displaySurvey('survey-id-123', {
  displayType: DisplaySurveyType.Inline,
  ignoreConditions: false,
  ignoreDelay: false,
  selector: '#survey-container'
})
```

```js
// Force display ignoring conditions and delays
posthog.displaySurvey('survey-id-123', {
  displayType: DisplaySurveyType.Popover,
  ignoreConditions: true,
  ignoreDelay: true
})
```

### `PostHog.getActiveMatchingSurveys`

> **getActiveMatchingSurveys**(`callback`, `forceReload?`): `void`

Get surveys that should be enabled for the current user. See [fetching surveys documentation](https://posthog.com/docs/surveys/implementing-custom-surveys.md#fetching-surveys-manually) for more details.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `callback` | `SurveyCallback` | `undefined` | The callback function will be called when the surveys are loaded or updated. |
| `forceReload?` | `boolean` | `false` | Whether to force a reload of the surveys. |

#### Returns

`void`

#### Example

```js
posthog.getActiveMatchingSurveys((surveys) => {
     // do something
})
```

### `PostHog.getSurveys`

> **getSurveys**(`callback`, `forceReload?`): `void`

Get list of all surveys.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `callback` | `SurveyCallback` | `undefined` | Function that receives the array of surveys. |
| `forceReload?` | `boolean` | `false` | Optional boolean to force an API call for updated surveys. |

#### Returns

`void`

#### Example

```js
function callback(surveys, context) {
  // do something
}

posthog.getSurveys(callback, false)
```

### `PostHog.onActiveMatchingSurveysChanged`

> **onActiveMatchingSurveysChanged**(`callback`): () => `void`

Register an event listener that runs when the set of active matching surveys changes.
The listener receives the initial matching set and updates after event/action triggers,
cancellation, consumption, session expiry, definitions refresh, captured pageviews,
feature-flag updates, marking a survey as seen, and reset. Unchanged results are suppressed.

URL conditions are re-evaluated on captured `$pageview` events, including automatic SPA
pageviews when `capture_pageview` is `'history_change'`. With automatic pageviews disabled,
capture `$pageview` after navigation. This does not observe arbitrary DOM mutations or time
passing; selector, device and wait-period conditions are checked on the supported updates.

The optional callback context distinguishes load errors from a successfully loaded empty
result. New subscribers receive the current snapshot without replaying earlier errors:
a settled unavailable state is `([], { isLoaded: false })`, while usable cached definitions
are evaluated normally. An initial load already in progress delivers when it resolves.
Recoverable load failures keep the subscription alive. Unsubscribing prevents any
further delivery, including callbacks from an outstanding initial request.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callback` | `SurveyCallback` | The callback to call with active matching surveys. |

#### Returns

A function that can be called to unsubscribe the listener.

() => `void`

#### Example

```js
const unsubscribe = posthog.onActiveMatchingSurveysChanged((surveys) => {
    // respond to changes in currently matching surveys
})
```

### `PostHog.onSurveysLoaded`

> **onSurveysLoaded**(`callback`): () => `void`

Register an event listener that runs when surveys are loaded.

Callback parameters:
- surveys: Survey[]: An array containing all survey objects fetched from PostHog using the getSurveys method
- context: { isLoaded: boolean, error?: string }: An object indicating if the surveys were loaded successfully

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callback` | `SurveyCallback` | The callback function will be called when surveys are loaded or updated. |

#### Returns

A function that can be called to unsubscribe the listener.

() => `void`

#### Example

```js
posthog.onSurveysLoaded((surveys, context) => { // do something })
```

### `PostHog.renderSurvey`

> **renderSurvey**(`surveyId`, `selector`): `void`

Although we recommend using popover surveys and display conditions,
if you want to show surveys programmatically without setting up all
the extra logic needed for API surveys, you can render surveys
programmatically with the renderSurvey method.

This takes a survey ID and an HTML selector to render an unstyled survey.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `surveyId` | `string` | The ID of the survey to render. |
| `selector` | `string` | The selector of the HTML element to render the survey on. |

#### Returns

`void`

#### Example

```js
posthog.renderSurvey(coolSurveyID, '#survey-container')
```

#### Deprecated

Use displaySurvey instead - it's more complete and also supports popover surveys.

### `DisplaySurveyType`

> `const` **DisplaySurveyType**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-inline"></a> `Inline` | `"inline"` |
| <a id="property-popover"></a> `Popover` | `"popover"` |

### `SurveyEventName`

> `const` **SurveyEventName**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-abandoned"></a> `ABANDONED` | `"survey abandoned"` |
| <a id="property-dismissed-1"></a> `DISMISSED` | `"survey dismissed"` |
| <a id="property-sent"></a> `SENT` | `"survey sent"` |
| <a id="property-shown-1"></a> `SHOWN` | `"survey shown"` |

### `SurveyEventProperties`

> `const` **SurveyEventProperties**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-product_tour_id"></a> `PRODUCT_TOUR_ID` | `"$product_tour_id"` |
| <a id="property-survey_completed"></a> `SURVEY_COMPLETED` | `"$survey_completed"` |
| <a id="property-survey_id"></a> `SURVEY_ID` | `"$survey_id"` |
| <a id="property-survey_iteration"></a> `SURVEY_ITERATION` | `"$survey_iteration"` |
| <a id="property-survey_iteration_start_date"></a> `SURVEY_ITERATION_START_DATE` | `"$survey_iteration_start_date"` |
| <a id="property-survey_language"></a> `SURVEY_LANGUAGE` | `"$survey_language"` |
| <a id="property-survey_last_seen_date"></a> `SURVEY_LAST_SEEN_DATE` | `"$survey_last_seen_date"` |
| <a id="property-survey_name"></a> `SURVEY_NAME` | `"$survey_name"` |
| <a id="property-survey_partially_completed"></a> `SURVEY_PARTIALLY_COMPLETED` | `"$survey_partially_completed"` |
| <a id="property-survey_questions"></a> `SURVEY_QUESTIONS` | `"$survey_questions"` |
| <a id="property-survey_response"></a> `SURVEY_RESPONSE` | `"$survey_response"` |
| <a id="property-survey_submission_id"></a> `SURVEY_SUBMISSION_ID` | `"$survey_submission_id"` |

### `SurveyEventType`

> `const` **SurveyEventType**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-activation"></a> `Activation` | `"events"` |
| <a id="property-cancellation"></a> `Cancellation` | `"cancelEvents"` |

### `SurveyPosition`

> `const` **SurveyPosition**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-center"></a> `Center` | `"center"` |
| <a id="property-left"></a> `Left` | `"left"` |
| <a id="property-middlecenter"></a> `MiddleCenter` | `"middle_center"` |
| <a id="property-middleleft"></a> `MiddleLeft` | `"middle_left"` |
| <a id="property-middleright"></a> `MiddleRight` | `"middle_right"` |
| <a id="property-nexttotrigger"></a> `NextToTrigger` | `"next_to_trigger"` |
| <a id="property-right"></a> `Right` | `"right"` |
| <a id="property-topcenter"></a> `TopCenter` | `"top_center"` |
| <a id="property-topleft"></a> `TopLeft` | `"top_left"` |
| <a id="property-topright"></a> `TopRight` | `"top_right"` |

### `SurveyQuestionBranchingType`

> `const` **SurveyQuestionBranchingType**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-end"></a> `End` | `"end"` |
| <a id="property-nextquestion"></a> `NextQuestion` | `"next_question"` |
| <a id="property-responsebased"></a> `ResponseBased` | `"response_based"` |
| <a id="property-specificquestion"></a> `SpecificQuestion` | `"specific_question"` |

### `SurveyQuestionType`

> `const` **SurveyQuestionType**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-link-2"></a> `Link` | `"link"` |
| <a id="property-multiplechoice"></a> `MultipleChoice` | `"multiple_choice"` |
| <a id="property-open"></a> `Open` | `"open"` |
| <a id="property-rating"></a> `Rating` | `"rating"` |
| <a id="property-singlechoice"></a> `SingleChoice` | `"single_choice"` |

### `SurveySchedule`

> `const` **SurveySchedule**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-always"></a> `Always` | `"always"` |
| <a id="property-once"></a> `Once` | `"once"` |
| <a id="property-recurring"></a> `Recurring` | `"recurring"` |

### `SurveyTabPosition`

> `const` **SurveyTabPosition**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-bottom"></a> `Bottom` | `"bottom"` |
| <a id="property-left-1"></a> `Left` | `"left"` |
| <a id="property-right-1"></a> `Right` | `"right"` |
| <a id="property-top"></a> `Top` | `"top"` |

### `SurveyType`

> `const` **SurveyType**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-api"></a> `API` | `"api"` |
| <a id="property-externalsurvey"></a> `ExternalSurvey` | `"external_survey"` |
| <a id="property-popover-1"></a> `Popover` | `"popover"` |
| <a id="property-widget"></a> `Widget` | `"widget"` |

### `SurveyWidgetType`

> `const` **SurveyWidgetType**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-button"></a> `Button` | `"button"` |
| <a id="property-selector-5"></a> `Selector` | `"selector"` |
| <a id="property-tab"></a> `Tab` | `"tab"` |
