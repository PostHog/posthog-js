import { useContext } from 'react'
import { PostHog, PostHogContext } from '../context'

export const usePostHog = (): PostHog | undefined => {
    const { client } = useContext(PostHogContext)
    return client
}
