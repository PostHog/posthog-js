import { PostHog } from '../posthog-rn'
import React from 'react'
import { PostHogContext } from '../PostHogContext'

export const usePostHog = (): PostHog => {
  const { client } = React.useContext(PostHogContext)
  return client
}
