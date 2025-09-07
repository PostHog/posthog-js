// Redux-compatible types without depending on Redux
// Copied from https://github.com/reduxjs/redux/blob/6c8c3a10f6e5a35f0c4a61413d7a93a53e4f11d4/src/types/actions.ts#L32

/**
 * An Action type which accepts any other properties.
 * This is mainly for the use of the `Reducer` type.
 * This is not part of `Action` itself to prevent types that extend `Action` from
 * having an index signature.
 */
export interface UnknownAction {
    type: string
    // Allows any extra properties to be defined in an action.
    [extraProps: string]: unknown
}

// Redux middleware types
export type Dispatch<A = UnknownAction> = (action: A) => A

export interface MiddlewareAPI<D extends Dispatch = Dispatch, S = any> {
    dispatch: D
    getState(): S
}

// we need to pass a _DispatchExt but TS doesn't like that it is unused
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface Middleware<_DispatchExt = object, S = any, D extends Dispatch = Dispatch> {
    (api: MiddlewareAPI<D, S>): (next: D) => (action: Parameters<D>[0]) => ReturnType<D>
}

export interface ReduxEvent {
    type: string
    payload?: any
    timestamp: number
    executionTimeMs?: number
    prevState: any
    nextState: any
}

export interface PostHogReplayReduxLoggerConfig<S = any> {
    maskReduxAction?: (action: UnknownAction) => UnknownAction | null
    maskReduxState?: (state: S, action?: UnknownAction) => S
    titleFunction?: (reduxEvent: ReduxEvent) => string
    logger?: (title: string, reduxEvent: ReduxEvent) => void
    diffState?: boolean
}

/**
 * Default title function for Redux events
 */
function defaultTitleFunction(reduxEvent: ReduxEvent): string {
    const { type, executionTimeMs } = reduxEvent
    const timeText = executionTimeMs !== undefined ? ` (${executionTimeMs.toFixed(2)}ms)` : ''
    return `[PostHog Redux Logger] ${type}${timeText}`
}

function defaultLogger(title: string, reduxEvent: ReduxEvent): void {
    console.log(title, reduxEvent)
}

/**
 * Get only the changed keys from two states
 * Returns { prevState: changedKeysOnly, nextState: changedKeysOnly }
 */
function getChangedStateKeys<S>(prevState: S, nextState: S): { prevState: Partial<S>; nextState: Partial<S> } {
    if (prevState === nextState) {
        return { prevState: {} as Partial<S>, nextState: {} as Partial<S> }
    }

    if (typeof prevState !== 'object' || typeof nextState !== 'object' || prevState === null || nextState === null) {
        return { prevState: prevState as Partial<S>, nextState: nextState as Partial<S> }
    }

    if (Array.isArray(prevState) || Array.isArray(nextState)) {
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
            if (
                typeof prevValue === 'object' &&
                typeof nextValue === 'object' &&
                prevValue !== null &&
                nextValue !== null &&
                !Array.isArray(prevValue) &&
                !Array.isArray(nextValue)
            ) {
                // Recursively handle nested objects
                const nested = getChangedStateKeys(prevValue, nextValue)
                if (Object.keys(nested.prevState).length > 0 || Object.keys(nested.nextState).length > 0) {
                    if (Object.keys(nested.prevState).length > 0) prevFiltered[key] = nested.prevState
                    if (Object.keys(nested.nextState).length > 0) nextFiltered[key] = nested.nextState
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

/**
 * Creates a Redux middleware that logs actions and state changes for PostHog session replay
 * This can be used as middleware in any Redux store to capture state changes
 */
export function posthogReplayReduxLogger<S = any>(
    config: PostHogReplayReduxLoggerConfig<S> = {}
): Middleware<object, S> {
    const {
        maskReduxAction = (action: UnknownAction) => action,
        maskReduxState = (state: S) => state,
        titleFunction = defaultTitleFunction,
        logger = defaultLogger,
        diffState = true,
    } = config

    return (store: MiddlewareAPI<Dispatch, S>) => (next: Dispatch) => (action: UnknownAction) => {
        // Get the state before the action
        const prevState = store.getState()

        // Track execution time
        // eslint-disable-next-line compat/compat
        const startTime = performance.now()

        const result = next(action)

        // eslint-disable-next-line compat/compat
        const endTime = performance.now()
        const executionTimeMs = endTime - startTime

        // Get the state after the action
        const nextState = store.getState()

        const maskedAction = maskReduxAction(action)

        if (!maskedAction) {
            return result
        }

        // Apply masking to states
        const maskedPrevState = maskReduxState(prevState, maskedAction)
        const maskedNextState = maskReduxState(nextState, maskedAction)

        let filteredPrevState: Partial<S>
        let filteredNextState: Partial<S>
        if (diffState) {
            const { prevState: diffedPrevState, nextState: diffedNextState } = getChangedStateKeys(
                maskedPrevState,
                maskedNextState
            )
            filteredPrevState = diffedPrevState
            filteredNextState = diffedNextState
        } else {
            filteredPrevState = maskedPrevState
            filteredNextState = maskedNextState
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

        logger(titleFunction(reduxEvent), reduxEvent)

        return result
    }
}
