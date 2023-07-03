import { useMemo, useState } from 'react'
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect'

export type SsrStateOptions = {
    /* If set to false, will potentially require fewer renders but violates React Hydration https://react.dev/reference/react-dom/hydrate */
    ssr?: boolean
}

let isHydrated = false

/**
 * Helper function to handle issues to do with Server Side Rendering (SSR) and hydration
 * Unlike useState, this hook will not return the initial state until the client is hydrated via a useEffect.
 * It also tries to render the intialState as fast as possible by using useLayoutEffect on the client
 * If not using SSR then it can be disabled via the options which will return the initial state immediately
 * @param initialStateFn - Function that returns the initial state
 * @param options - (Optional) Allows disabling SSR support for client-side only apps
 * @returns
 */
export const useSsrSafeState = <T>(
    initialStateFn: () => T,
    options?: SsrStateOptions
): [T | undefined, React.Dispatch<React.SetStateAction<T>>] => {
    // We get the initial state only if we are hydrated already or if SSR is disabled
    const initialState = useMemo(() => {
        return isHydrated || options?.ssr === false ? initialStateFn() : undefined
    }, [initialStateFn, options?.ssr])

    const [state, setState] = useState<T | undefined>(initialState)

    useIsomorphicLayoutEffect(() => {
        // Indicate we are hydrated for future renders whilst also setting the initial state
        isHydrated = true
        if (initialState === undefined) {
            setState(initialStateFn())
        }
    }, [])

    return [state, setState]
}
