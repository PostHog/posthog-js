import { useContext } from "react"

export const usePostHog = (): PostHog | undefined => {
    const { client } = useContext(PostHogContext)
    return client
}