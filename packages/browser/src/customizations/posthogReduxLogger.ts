import { BucketedRateLimiter, isNullish, isObject, Logger } from '@posthog/core'
import { createLogger } from '../utils/logger'

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

export interface ReduxEvent {
    type: string
    payload?: any
    timestamp: number
    executionTimeMs?: number
    prevState: any
    nextState: any
}

export interface PostHogReduxLoggerConfig<S = any> {
    maskReduxAction?: (action: UnknownAction) => UnknownAction | null
    maskReduxState?: (state: S, action?: UnknownAction) => S
    titleFunction?: (reduxEvent: ReduxEvent) => string
    logger?: (title: string, reduxEvent: ReduxEvent) => void
    diffState?: boolean
    /**
     * redux actions logging is token bucket rate limited to avoid flooding
     * this controls the rate limiter's refill rate, see BucketedRateLimiter docs for details
     * normally this is only changed with posthog support assistance
     */
    rateLimiterRefillRate?: number
    /**
     * redux actions logging is token bucket rate limited to avoid flooding
     * this controls the rate limiter's bucket size, see BucketedRateLimiter docs for details
     * normally this is only changed with posthog support assistance
     */
    rateLimiterBucketSize?: number
    /**
     * separately invoked for the time taken to process each action
     * can be used to e.g. emit a log or event when there is a slow action
     */
    onDuration?: (title: string, reduxEvent: ReduxEvent, durationMs: number) => void
}

/**
 * Default title function for Redux events
 */
function defaultTitleFunction(reduxEvent: ReduxEvent): string {
    const { type, executionTimeMs } = reduxEvent
    const timeText = isNullish(executionTimeMs) ? '' : ` (${executionTimeMs.toFixed(2)}ms)`
    return `${type}${timeText}`
}

const phConsoleLogger: Logger = createLogger('[PostHog Redux Logger]')

function defaultLogger(title: string, reduxEvent: ReduxEvent): void {
    // eslint-disable-next-line no-console
    phConsoleLogger.info(title, reduxEvent)
}

/**
 * Get only the changed keys from two states
 * Returns { prevState: changedKeysOnly, nextState: changedKeysOnly }
 */
function getChangedStateKeys<S>(prevState: S, nextState: S): { prevState?: Partial<S>; nextState?: Partial<S> } {
    if (!isObject(prevState) || !isObject(nextState)) {
        // we ony support objects as state, but can't guarantee that's what we'll get
        return {}
    }

    if (prevState === nextState) {
        return { prevState: {} as Partial<S>, nextState: {} as Partial<S> }
    }

    if (isNullish(prevState) || isNullish(nextState)) {
        return { prevState: prevState as Partial<S>, nextState: nextState as Partial<S> }
    }

    const prevFiltered: Record<string, any> = {}
    const nextFiltered: Record<string, any> = {}
    const allKeys = new Set([...Object.keys(prevState as any), ...Object.keys(nextState as any)])

    for (const key of allKeys) {
        const prevValue = (prevState as any)[key]
        const nextValue = (nextState as any)[key]

        if (!(key in (prevState as any))) {
            // Key was added
            nextFiltered[key] = nextValue
        } else if (!(key in (nextState as any))) {
            // Key was removed
            prevFiltered[key] = prevValue
        } else if (prevValue !== nextValue) {
            // Key was changed
            if (isObject(prevValue) && isObject(nextValue) && !isNullish(prevValue) && !isNullish(nextValue)) {
                // Recursively handle nested objects
                const nested = getChangedStateKeys(prevValue, nextValue)
                const nestedPrevState = nested.prevState ?? {}
                const nestedNextState = nested.nextState ?? {}
                if (Object.keys(nestedPrevState).length > 0 || Object.keys(nestedNextState).length > 0) {
                    if (Object.keys(nestedPrevState).length > 0) prevFiltered[key] = nestedPrevState
                    if (Object.keys(nestedNextState).length > 0) nextFiltered[key] = nestedNextState
                }
            } else {
                // Primitive values or arrays - include both
                prevFiltered[key] = prevValue
                nextFiltered[key] = nextValue
            }
        }
    }

    return {
        prevState: prevFiltered as Partial<S>,
        nextState: nextFiltered as Partial<S>,
    }
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
 * Creates a Redux middleware that logs actions and state changes to a provided logger
 * This can be used as middleware in any Redux store to capture state changes
 *
 * The logging uses token-bucket rate limiting to avoid flooding the logging with many changes
 * by default logging rate limiting captures ten action instances before rate limiting by action type
 * refills at a rate of one token / 1-second period
 * e.g. will capture 1 rate limited action every 1 second until the burst ends
 */
export function posthogReduxLogger<S = any>(
    config: PostHogReduxLoggerConfig<S> = {}
    // the empty object is the recommended typing from redux docs
    //eslint-disable-next-line @typescript-eslint/no-empty-object-type
): ReduxMiddleware<{}, S> {
    const {
        maskReduxAction = (action: UnknownAction) => action,
        maskReduxState = (state: S) => state,
        titleFunction = defaultTitleFunction,
        logger = defaultLogger,
        diffState = true,
        rateLimiterRefillRate = 1,
        rateLimiterBucketSize = 10,
        onDuration = () => {},
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

            const maskedAction = maskReduxAction(typedAction)

            if (!maskedAction) {
                return result
            }

            const isRateLimited = rateLimiter.consumeRateLimit(typedAction.type)

            if (isRateLimited) {
                debouncedActionRateLimitedLogger.info(typedAction.type)
            } else {
                // Apply masking to states
                try {
                    const maskedPrevState = maskReduxState(prevState, maskedAction)
                    const maskedNextState = maskReduxState(nextState, maskedAction)

                    type FilteredState = { 'invalid state'?: string } | (S & Record<string, any>)
                    let filteredPrevState: FilteredState
                    let filteredNextState: FilteredState
                    if (diffState) {
                        const { prevState: diffedPrevState, nextState: diffedNextState } = getChangedStateKeys(
                            maskedPrevState,
                            maskedNextState
                        )
                        const invalidPayloadForDiffing: FilteredState = { 'invalid state': 'no changes after diffing' }
                        filteredPrevState = (diffedPrevState as FilteredState) ?? invalidPayloadForDiffing
                        filteredNextState = (diffedNextState as FilteredState) ?? invalidPayloadForDiffing
                    } else {
                        const invalidPayloadForLogging = { 'invalid state': 'logger only supports object payloads' }
                        filteredPrevState = isObject(maskedPrevState) ? maskedPrevState : invalidPayloadForLogging
                        filteredNextState = isObject(maskedNextState) ? maskedNextState : invalidPayloadForLogging
                    }

                    const { type, ...actionData } = maskedAction

                    const reduxEvent: ReduxEvent = {
                        type,
                        payload: actionData,
                        timestamp: Date.now(),
                        executionTimeMs,
                        prevState: filteredPrevState,
                        nextState: filteredNextState,
                    }

                    const title = titleFunction(reduxEvent)
                    logger(title, reduxEvent)
                    onDuration(title, reduxEvent, executionTimeMs)
                } catch (e: any) {
                    // logging should never throw errors and break someone's app
                    phConsoleLogger.error('Error logging state:', e)
                }
            }

            return result
        }
}
