import React from 'react'
import { PostHog } from './posthog-rn'

export const PostHogContext = React.createContext<{ client: PostHog }>({ client: undefined as unknown as PostHog })
