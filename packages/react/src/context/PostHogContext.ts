import type { PostHog } from 'posthog-js'
import type { BootstrapConfig } from 'posthog-js'
import { createContext } from 'react'
import { getDefaultPostHogInstance } from './posthog-default'

export type { PostHog }

// The getter defers evaluation so that the full bundle's setDefaultPostHogInstance()
// call (which runs after module evaluation) has already executed by the time React
// accesses the default value. In the slim bundle no default is set, so client will
// be undefined — users must always provide a <PostHogProvider client={…}>.
export const PostHogContext = createContext<{ client: PostHog; bootstrap?: BootstrapConfig }>({
    get client() {
        return getDefaultPostHogInstance() as PostHog
    },
    bootstrap: undefined,
})
