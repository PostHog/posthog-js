import { useContext } from 'react'
import { PostHog, PostHogContext } from '../context'

export const usePostHog = (): PostHog => {
    const { client } = useContext(PostHogContext)
    return client
}
