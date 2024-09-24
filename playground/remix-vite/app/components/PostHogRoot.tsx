import { useEffect } from 'react'
import { usePostHog } from '../PostHogProvider'

export function PostHogRoot() {
    const posthog = usePostHog()
    useEffect(() => {
        posthog?.identify('test@test.com', {
            email: 'test@test.com',
        })
        posthog?.capture('$pageview')
    }, [posthog])
    return <></>
}
