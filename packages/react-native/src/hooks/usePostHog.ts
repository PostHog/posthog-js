import type { PostHog } from '../posthog-rn'
import React from 'react'
import { PostHogContext } from '../PostHogContext'

export const usePostHog = (): PostHog => {
  const { client } = React.useContext(PostHogContext)
  if (!client) {
    throw new Error(
      'usePostHog must be used within a PostHogProvider. See https://posthog.com/docs/libraries/react-native#with-the-posthogprovider'
    )
  }
  return client
}
