import { ErrorTracking as CoreErrorTracking, isString, isArray, isObject } from '@posthog/core'

/**
 * App lifecycle events the SDK captures in `captureAppLifecycleEvents`. The step message is the
 * event name itself, so the timeline reads the same as the event list.
 */
const LIFECYCLE_EVENTS = new Set<string>([
  'Application Installed',
  'Application Updated',
  'Application Opened',
  'Application Became Active',
  'Application Backgrounded',
])

const TOUCH_EVENT_TYPE = 'touch'

export type AutomaticExceptionStep = {
  type: CoreErrorTracking.ExceptionStepType
  message: string
}

/**
 * Maps an enqueued event to the automatic exception step it should leave behind, or `undefined` when
 * the event is not a signal the caller enabled.
 *
 * The function is pure and reads only the event name and its properties, so the caller can run it on
 * the capture path without touching the SDK's state.
 */
export function buildAutomaticExceptionStep(
  config: CoreErrorTracking.ResolvedAutomaticExceptionStepsConfig,
  event: unknown,
  properties: unknown
): AutomaticExceptionStep | undefined {
  if (!isString(event)) {
    return undefined
  }

  if (config.navigation && event === '$screen') {
    return buildNavigationStep(properties)
  }

  if (config.taps && event === '$autocapture') {
    return buildTapStep(properties)
  }

  if (config.lifecycle && LIFECYCLE_EVENTS.has(event)) {
    return { type: CoreErrorTracking.EXCEPTION_STEP_TYPES.LIFECYCLE, message: event }
  }

  return undefined
}

function buildNavigationStep(properties: unknown): AutomaticExceptionStep | undefined {
  const screenName = readStringProperty(properties, '$screen_name')
  if (!screenName) {
    return undefined
  }

  return { type: CoreErrorTracking.EXCEPTION_STEP_TYPES.NAVIGATION, message: `Screen: ${screenName}` }
}

/**
 * Only a touch leaves a tap step. The label comes from the innermost autocaptured element, which
 * holds either a `ph-label` or a component display name.
 *
 * The step never carries `$el_text` or touch coordinates. Element text is user-visible copy and can
 * hold personal data, and an exception timeline does not need the pixel the user hit.
 */
function buildTapStep(properties: unknown): AutomaticExceptionStep | undefined {
  if (readStringProperty(properties, '$event_type') !== TOUCH_EVENT_TYPE) {
    return undefined
  }

  const label = readTapLabel(properties)
  return {
    type: CoreErrorTracking.EXCEPTION_STEP_TYPES.TAP,
    message: label ? `Tap: ${label}` : 'Tap',
  }
}

function readTapLabel(properties: unknown): string | undefined {
  const elements = isObject(properties) ? (properties as Record<string, unknown>).$elements : undefined
  if (!isArray(elements) || elements.length === 0) {
    return undefined
  }

  // Elements run innermost first, so the first entry is the element the user actually hit.
  return readStringProperty(elements[0], 'tag_name')
}

function readStringProperty(source: unknown, key: string): string | undefined {
  if (!isObject(source)) {
    return undefined
  }

  const value = (source as Record<string, unknown>)[key]
  if (!isString(value) || value.trim().length === 0) {
    return undefined
  }

  return value
}
