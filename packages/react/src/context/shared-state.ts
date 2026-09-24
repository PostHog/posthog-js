import { createContext, type Context } from 'react'
import type { PostHog } from 'posthog-js'
import type { BootstrapConfig } from 'posthog-js'

export type PostHogContextValue = { client: PostHog; bootstrap?: BootstrapConfig }

// Other versions of this package on the same page read and write this shape, so it may only be
// extended. An incompatible change needs a new GLOBAL_KEY.
interface SharedState {
    defaultPostHogInstance?: PostHog
    context?: Context<PostHogContextValue>
}

const GLOBAL_KEY = '__POSTHOG_REACT_SHARED_STATE__'
const globalObject: any = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {}
let statesByReact: WeakMap<typeof createContext, SharedState>
try {
    statesByReact = globalObject[GLOBAL_KEY] = globalObject[GLOBAL_KEY] || new WeakMap()
} catch {
    // A non-extensible global object: entrypoints still work, but don't share state.
    statesByReact = new WeakMap()
}

// The main, slim, and surveys entrypoints are bundled separately, so each one carries its own copy
// of every module. State that must be shared between them lives on the global object, so that a
// hook imported from one entrypoint reads the provider rendered from another. It is keyed by the
// React copy, because a context only works with the React that created it.
if (!statesByReact.has(createContext)) {
    statesByReact.set(createContext, {})
}
export const sharedState = statesByReact.get(createContext) as SharedState
