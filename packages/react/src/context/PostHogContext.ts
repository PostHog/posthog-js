import posthogJs, { BootstrapConfig } from 'posthog-js'
import { createContext } from 'react'

export type PostHog = typeof posthogJs

export const PostHogContext = createContext<{ client: PostHog; bootstrap?: BootstrapConfig }>({
    client: posthogJs,
    bootstrap: undefined,
})
