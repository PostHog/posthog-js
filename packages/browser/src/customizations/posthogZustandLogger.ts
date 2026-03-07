import { BucketedRateLimiter, isNullish, Logger } from '@posthog/core'
import { createLogger } from '../utils/logger'

import {
    browserConsoleLogger,
    getChangedState,
    type PostHogStateLogger,
    type StateEvent,
} from './posthogReduxLogger'

interface ZustandStoreApi<S> {
    getState(): S
}

export interface PostHogZustandTrackerConfig<S = any> {
    store: ZustandStoreApi<S>
    /** Pass sessionRecordingLoggerForPostHogInstance(posthog) to send events to replay */
    logger?: PostHogStateLogger
    /** Runs on both prevState and nextState before diffing — use this to redact sensitive fields */
    maskState?: (state: S) => S
    titleFunction?: (stateEvent: StateEvent) => string
    /**
     * Token bucket rate limiting to avoid flooding recordings with rapid state changes.
     * Normally only changed with PostHog support assistance.
     */
    rateLimiterRefillRate?: number
    rateLimiterBucketSize?: number
    /**
     * Controls how deep the state diff goes. Increase if nested changes aren't showing up,
     * decrease if diffs are too noisy. Higher values cost more CPU.
     * @default 5
     */
    __stateComparisonDepth?: number
    /**
     * Which parts of the state to include in the event.
     * The more you include, the more likely events get dropped by size limits.
     */
    include?: {
        prevState?: boolean
        nextState?: boolean
        changedState?: boolean
    }
}

function defaultTitleFunction(stateEvent: StateEvent): string {
    const { type, executionTimeMs } = stateEvent
    const timeText = isNullish(executionTimeMs) ? '' : ` (${executionTimeMs.toFixed(2)}ms)`
    return `${type}${timeText}`
}

const phConsoleLogger: Logger = createLogger('[PostHog Zustand RateLimiting]')

const createDebouncedRateLimitLogger = () => {
    let timeout: ReturnType<typeof setTimeout> | null = null
    let ignoredCount = 0
    let lastActionType: string | null = null

    return {
        info: (actionType: string) => {
            if (lastActionType !== actionType) {
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

const debouncedRateLimitLogger = createDebouncedRateLimitLogger()

/**
 * Tracks named Zustand actions for session replay. Explicit rather than automatic
 * because Zustand doesn't have action types like Redux.
 */
export function posthogZustandTracker<S = any>(config: PostHogZustandTrackerConfig<S>) {
    const {
        store,
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
        refillInterval: 1000,
        _logger: phConsoleLogger,
    })

    function logStateChange(actionName: string, prevState: S, nextState: S, executionTimeMs: number): void {
        const isRateLimited = rateLimiter.consumeRateLimit(actionName)

        if (isRateLimited) {
            debouncedRateLimitLogger.info(actionName)
            return
        }

        try {
            const maskedPrevState = maskState ? maskState(prevState) : prevState
            const maskedNextState = maskState ? maskState(nextState) : nextState
            const changedState = include.changedState
                ? getChangedState(maskedPrevState, maskedNextState, __stateComparisonDepth ?? 5)
                : undefined

            const stateEvent: StateEvent = {
                type: actionName,
                timestamp: Date.now(),
                executionTimeMs,
                prevState: include.prevState ? maskedPrevState : undefined,
                nextState: include.nextState ? maskedNextState : undefined,
                changedState: include.changedState ? changedState : undefined,
            }

            const title = titleFunction(stateEvent)
            logger(title, stateEvent)
        } catch (e: any) {
            // Logging should never break the customer's app
            phConsoleLogger.error('Error logging state:', e)
        }
    }

    function trackAction<R>(actionName: string, fn: () => R): R {
        const prevState = store.getState()
        // eslint-disable-next-line compat/compat
        const startTime = performance.now()

        const result = fn()

        if (result instanceof Promise) {
            return result.finally(() => {
                // eslint-disable-next-line compat/compat
                const executionTimeMs = performance.now() - startTime
                const nextState = store.getState()
                logStateChange(actionName, prevState, nextState, executionTimeMs)
            }) as R
        }

        // eslint-disable-next-line compat/compat
        const executionTimeMs = performance.now() - startTime
        const nextState = store.getState()
        logStateChange(actionName, prevState, nextState, executionTimeMs)

        return result
    }

    return trackAction
}
