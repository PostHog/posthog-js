import { useContext, useEffect } from 'react'
import { usePostHogContext } from '../context'

export function usePostHogExample(): void {
    const context = usePostHogContext()
    const { client: posthog } = useContext(context)

    useEffect(() => {
        console.log(posthog)
    }, [])
}
