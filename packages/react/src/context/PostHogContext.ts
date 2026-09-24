import type { PostHog } from 'posthog-js'
import { createContext } from 'react'
import { getDefaultPostHogInstance } from './posthog-default'
import { sharedState, type PostHogContextValue } from './shared-state'

export type { PostHog }

if (!sharedState.context) {
    // The getter defers evaluation so that the full bundle's setDefaultPostHogInstance()
    // call (which runs after module evaluation) has already executed by the time React
    // accesses the default value. When only the slim bundle is loaded no default is set, so client
    // will be undefined — users must always provide a <PostHogProvider client={…}>.
    sharedState.context = createContext<PostHogContextValue>({
        get client() {
            return getDefaultPostHogInstance() as PostHog
        },
        bootstrap: undefined,
    })
}

export const PostHogContext = sharedState.context
