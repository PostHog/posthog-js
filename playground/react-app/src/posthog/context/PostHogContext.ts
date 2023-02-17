import posthogJs from 'posthog-js'
import { createContext } from 'react'

export type PostHog = typeof posthogJs

export const PostHogContext = createContext<{ client?: PostHog }>({ client: undefined })
