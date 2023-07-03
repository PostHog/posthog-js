import { useMemo, useState } from 'react'
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect'

export type SsrStateOptions = {
    /* If set to false, will potentially require fewer renders but violates React Hydration https://react.dev/reference/react-dom/hydrate */
    ssr?: boolean
}

/**
 * Helper function to handle issues to do with SSR and hydration
 * Unlike useState, this hook will not return the initial state until the client is hydrated.
 * Once hydrated, the initial state will be returned, e.g. due to client side routing
 * It also tries to render the intialState as fast as possible by using useLayoutEffect on the client
 * @param initialStateFn - Function that returns the initial state
 * @param options - (Optional) Allows disabling SSR support for client-side only apps
 * @returns
 */
export const useSsrSafeState = <T>(
    initialStateFn: () => T,
    options?: SsrStateOptions
): [T | undefined, React.Dispatch<React.SetStateAction<T>>] => {
    // We get the initial state only if we are hydrated already
    const initialState = useMemo(() => {
        return options?.ssr === false ? initialStateFn() : undefined
    }, [initialStateFn, options?.ssr])

    const [state, setState] = useState<T | undefined>(initialState)

    useIsomorphicLayoutEffect(() => {
        if (initialState === undefined) {
            setState(initialStateFn())
        }
    }, [])

    return [state, setState]
}
