import type { PostHog } from '../posthog-rn'
import React from 'react'
import { PostHogContext } from '../PostHogContext'
import { warnIfNoClient } from './utils'

export const usePostHog = (): PostHog => {
  const { client } = React.useContext(PostHogContext)
  warnIfNoClient(client, 'usePostHog')
  return client
}
