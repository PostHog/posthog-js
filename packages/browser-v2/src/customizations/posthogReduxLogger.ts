import { BucketedRateLimiter, isEmptyObject, isNullish, isObject, isUndefined, Logger } from '@posthog/core'
import { createLogger } from '../utils/logger'
import type { PostHog } from '../posthog-core'

// types copied from redux toolkit so we can avoid taking a dependency in the library and confusing people using the SDK

/**
 * An *unknown* action.
 * This is the most minimal possible shape for an action.
 * Allows for type-safe usage of actions without dependencies.
 */
export interface UnknownAction {
    type: string
    [extraProps: string]: unknown
}

/**
 * A *dispatching function* (or simply *dispatch function*) is a function that
 * accepts an action or an async action; it then may or may not dispatch one
 * or more actions to the store.
 */
export interface Dispatch<A extends UnknownAction = UnknownAction> {
    <T extends A>(action: T): T
}

/**
 * A middleware is a higher-order function that composes a dispatch function
 * to return a new dispatch function. It often turns async actions into
 * actions.
 *
 * This matches Redux Toolkit's Middleware interface for compatibility.
 */
export interface ReduxMiddleware<
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type
    _DispatchExt = {},
    S = any,
    D extends Dispatch = Dispatch,
> {
    (api: MiddlewareAPI<D, S>): (next: (action: unknown) => unknown) => (action: unknown) => unknown
}

/**
 * A middleware API is an object containing the store's dispatch function and getState function.
 * A middleware is given the middleware API as its first parameter.
 */
export interface MiddlewareAPI<D extends Dispatch = Dispatch, S = any> {
    dispatch: D
    getState(): S
}

// end of copied types

export interface StateEvent {
    type: string
    payload?: any
    timestamp: number
    executionTimeMs?: number
    prevState: any
    nextState: any
    changedState: any
}

export type PostHogStateLogger = (title: string, stateEvent: StateEvent) => void

export interface PostHogStateLoggerConfig<S = any> {
    maskAction?: (action: UnknownAction) => UnknownAction | null
    maskState?: (state: S, action?: UnknownAction) => S
    titleFunction?: (stateEvent: StateEvent) => string
    logger?: PostHogStateLogger
    /**
     * actions logging is token bucket rate limited to avoid flooding
     * this controls the rate limiter's refill rate, see BucketedRateLimiter docs for details
     * normally this is only changed with posthog support assistance
     */
    rateLimiterRefillRate?: number
    /**
     * actions logging is token bucket rate limited to avoid flooding
     * this controls the rate limiter's bucket size, see BucketedRateLimiter docs for details
     * normally this is only changed with posthog support assistance
     */
    rateLimiterBucketSize?: number
    /**
     * Controls how many levels deep the state diffing goes when looking for changed keys
     * Defaults to 5
     * Increase this if you have nested state changes that are not being captured
     * Decrease this if you are seeing too much state in the diffs and want to reduce noise
     * Note that increasing this will increase the CPU cost of diffing, so use with caution
     * and only increase if necessary
     * Normally this is only changed with posthog support assistance
     */
    __stateComparisonDepth?: number
    /**
     * Which parts of the state event to include in the logged event
     * By default we include, previous and changed keys only
     *
     * NB the more you include the more likely a log will be dropped by rate limiting or max size limits
     */
    include?: {
        prevState?: boolean
        nextState?: boolean
        changedState?: boolean
    }
}

/**
 * Default title function for Redux events
 */
function defaultTitleFunction(stateEvent: StateEvent): string {
    const { type, executionTimeMs } = stateEvent
    const timeText = isNullish(executionTimeMs) ? '' : ` (${executionTimeMs.toFixed(2)}ms)`
    return `${type}${timeText}`
}

// we need a posthog logger for the rate limiter
const phConsoleLogger: Logger = createLogger('[PostHog Action RateLimiting]')

export function browserConsoleLogger(title: string, stateEvent: StateEvent): void {
    // but the posthog logger swallows messages unless debug is on
    // so we don't want to use it in this default logger
    // eslint-disable-next-line no-console
    console.log(title, stateEvent)
}

/**
 * Logger that sends state events to PostHog session recordings
 * Requires that the loaded posthog instance is provided
 * And returns the function to use as the logger
 *
 * e.g. const config = { logger: sessionRecordingLoggerForPostHogInstance(posthog) }
 */
export const sessionRecordingLoggerForPostHogInstance: (posthog: PostHog) => PostHogStateLogger =
    (postHogInstance: PostHog) =>
    (title: string, stateEvent: StateEvent): void => {
        postHogInstance?.sessionRecording?.tryAddCustomEvent('app-state', { title, stateEvent })
    }

/**
 * Get only the changed keys from two states
 * NB exported for testing purposes only, not part of the public API and may change without warning
 *
 * Returns { prevState: changedKeysOnly, nextState: changedKeysOnly }
 */
export function getChangedState<S>(prevState: S, nextState: S, maxDepth: number = 5): Partial<S> {
    // Fast bailouts
    if (typeof prevState !== 'object' || typeof nextState !== 'object') return {}
    if (prevState === nextState) return {}
    // all keys changed when no previous state
    if (!prevState && nextState) return nextState
    // something weird has happened, return empty
    if (!nextState || !prevState) return {}

    const changed: any = {}
    const allKeys = new Set([...Object.keys(prevState), ...Object.keys(nextState)])

    for (const key of allKeys) {
        const prevValue = (prevState as any)[key]
        const nextValue = (nextState as any)[key]

        // Key exists in only one object
        if (isUndefined(prevValue)) {
            changed[key] = nextValue
            continue
        }
        if (isUndefined(nextValue)) {
            changed[key] = prevValue
            continue
        }

        // Same value
        if (prevValue === nextValue) {
            continue
        }

        // Both null/undefined
        if (isNullish(prevValue) && isNullish(nextValue)) {
            continue
        }

        // Primitive or one is null
        if (!isObject(prevValue) || !isObject(nextValue)) {
            changed[key] = nextValue
            continue
        }

        // Both are objects, recurse if under max depth
        if (maxDepth > 1) {
            const childChanged = getChangedState(prevValue, nextValue, maxDepth - 1)
            if (!isEmptyObject(childChanged)) {
                changed[key] = childChanged
            }
        } else {
            changed[key] = `max depth reached, checking for changed value`
        }
    }

    return changed
}

// Debounced logger for rate limit messages
const createDebouncedActionRateLimitedLogger = () => {
    let timeout: ReturnType<typeof setTimeout> | null = null
    let ignoredCount = 0
    let lastActionType: string | null = null

    return {
        info: (actionType: string) => {
            if (lastActionType !== actionType) {
                // Reset counter when action type changes
                ignoredCount = 0
                lastActionType = actionType
            }

            ignoredCount++

            if (timeout) {
                clearTimeout(timeout)
            }

            timeout = setTimeout(() => {
                const count = ignoredCount

                if (count === 1) {
                    phConsoleLogger.info(`action "${actionType}" has been rate limited`)
                } else {
                    phConsoleLogger.info(`action "${actionType}" has been rate limited (${count} times)`)
                }

                ignoredCount = 0
                timeout = null
            }, 1000)
        },
    }
}

const debouncedActionRateLimitedLogger = createDebouncedActionRateLimitedLogger()

/**
 * Creates a Kea plugin that logs actions and state changes to a provided logger
 * This can be used as a plugin in any Kea setup to capture state changes
 */
export function posthogKeaLogger<S = any>(config: PostHogStateLoggerConfig<S> = {}) {
    const middleware = posthogReduxLogger(config)

    return {
        name: 'posthog-kea-logger',
        events: {
            beforeReduxStore(options: any) {
                options.middleware.push(middleware)
            },
        },
    }
}

/**
 * Creates a Redux middleware that logs actions and state changes to a provided logger
 * This can be used as middleware in any Redux store to capture state changes
 *
 * The logging uses token-bucket rate limiting to avoid flooding the logging with many changes
 * by default logging rate limiting captures ten action instances before rate limiting by action type
 * refills at a rate of one token / 1-second period
 * e.g. will capture 1 rate limited action every 1 second until the burst ends
 */
export function posthogReduxLogger<S = any>(
    config: PostHogStateLoggerConfig<S> = {}
    // the empty object is the recommended typing from redux docs
    //eslint-disable-next-line @typescript-eslint/no-empty-object-type
): ReduxMiddleware<{}, S> {
    const {
        maskAction,
        maskState,
        titleFunction = defaultTitleFunction,
        logger = browserConsoleLogger,
        include = {
            prevState: true,
            nextState: false,
            changedState: true,
        },
        rateLimiterRefillRate = 1,
        rateLimiterBucketSize = 10,
        __stateComparisonDepth,
    } = config

    const rateLimiter: BucketedRateLimiter<string> = new BucketedRateLimiter({
        refillRate: rateLimiterRefillRate,
        bucketSize: rateLimiterBucketSize,
        refillInterval: 1000, // one second in milliseconds,
        _logger: phConsoleLogger,
    })

    return (store: MiddlewareAPI<Dispatch, S>) =>
        (next: (action: unknown) => unknown) =>
        (action: unknown): unknown => {
            const typedAction = action as UnknownAction
            // Get the state before the action
            const prevState = store.getState()

            // Track execution time
            // eslint-disable-next-line compat/compat
            const startTime = performance.now()

            const result = next(typedAction)

            // eslint-disable-next-line compat/compat
            const endTime = performance.now()
            const executionTimeMs = endTime - startTime

            // Get the state after the action
            const nextState = store.getState()

            const maskedAction = maskAction ? maskAction(typedAction) : typedAction

            if (!maskedAction) {
                return result
            }

            const isRateLimited = rateLimiter.consumeRateLimit(typedAction.type)

            if (isRateLimited) {
                debouncedActionRateLimitedLogger.info(typedAction.type)
            } else {
                // Apply masking to states
                try {
                    const maskedPrevState = maskState ? maskState(prevState, maskedAction) : prevState
                    const maskedNextState = maskState ? maskState(nextState, maskedAction) : nextState
                    const changedState = include.changedState
                        ? getChangedState(maskedPrevState, maskedNextState, __stateComparisonDepth ?? 5)
                        : undefined
                    const { type, ...actionData } = maskedAction

                    const reduxEvent: StateEvent = {
                        type,
                        payload: actionData,
                        timestamp: Date.now(),
                        executionTimeMs,
                        prevState: include.prevState ? maskedPrevState : undefined,
                        nextState: include.nextState ? maskedNextState : undefined,
                        changedState: include.changedState ? changedState : undefined,
                    }

                    const title = titleFunction(reduxEvent)
                    logger(title, reduxEvent)
                } catch (e: any) {
                    // logging should never throw errors and break someone's app
                    phConsoleLogger.error('Error logging state:', e)
                }
            }

            return result
        }
}
