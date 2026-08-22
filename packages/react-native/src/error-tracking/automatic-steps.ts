import { isString, isArray, isObject } from '@posthog/core'

/**
 * `$type` values the SDK sets on an automatic step, so the error tracking timeline labels the step.
 * The signals are the ones React Native observes, so the vocabulary lives here rather than in
 * `@posthog/core`, which every SDK shares.
 */
export const EXCEPTION_STEP_TYPES = {
  NAVIGATION: 'navigation',
  TAP: 'tap',
  LIFECYCLE: 'lifecycle',
} as const

export type ExceptionStepType = (typeof EXCEPTION_STEP_TYPES)[keyof typeof EXCEPTION_STEP_TYPES]

/**
 * Which app signals the SDK turns into automatic steps. Every signal is opt-in, because a step adds
 * bytes to each captured exception and the buffer already carries whatever the caller added by hand.
 */
export type AutomaticExceptionStepsOptions = {
  /** Screen changes. @default false */
  navigation?: boolean
  /** Taps the SDK already autocaptures. @default false */
  taps?: boolean
  /** App lifecycle transitions such as open, foreground and background. @default false */
  lifecycle?: boolean
}

export type ResolvedAutomaticExceptionStepsOptions = {
  navigation: boolean
  taps: boolean
  lifecycle: boolean
}

const ALL_SIGNALS_OFF: ResolvedAutomaticExceptionStepsOptions = {
  navigation: false,
  taps: false,
  lifecycle: false,
}

const ALL_SIGNALS_ON: ResolvedAutomaticExceptionStepsOptions = {
  navigation: true,
  taps: true,
  lifecycle: true,
}

/**
 * Resolves the automatic-steps options. `true` enables every signal, `false` and `undefined` disable
 * every signal, and an object enables only the signals it sets.
 */
export function resolveAutomaticExceptionStepsOptions(
  options?: boolean | AutomaticExceptionStepsOptions | null
): ResolvedAutomaticExceptionStepsOptions {
  if (options === true) {
    return { ...ALL_SIGNALS_ON }
  }

  if (!options || !isObject(options)) {
    return { ...ALL_SIGNALS_OFF }
  }

  return {
    navigation: options.navigation ?? ALL_SIGNALS_OFF.navigation,
    taps: options.taps ?? ALL_SIGNALS_OFF.taps,
    lifecycle: options.lifecycle ?? ALL_SIGNALS_OFF.lifecycle,
  }
}

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
  type: ExceptionStepType
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
  config: ResolvedAutomaticExceptionStepsOptions,
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
    return { type: EXCEPTION_STEP_TYPES.LIFECYCLE, message: event }
  }

  return undefined
}

function buildNavigationStep(properties: unknown): AutomaticExceptionStep | undefined {
  const screenName = readStringProperty(properties, '$screen_name')
  if (!screenName) {
    return undefined
  }

  return { type: EXCEPTION_STEP_TYPES.NAVIGATION, message: `Screen: ${screenName}` }
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
    type: EXCEPTION_STEP_TYPES.TAP,
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
