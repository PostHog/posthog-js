import { useEffect, useState } from 'react'
import posthog from 'posthog-js'
import { PostHogProvider } from '@posthog/react'

export function PHProvider({ children }: { children: React.ReactNode }) {
    const [hydrated, setHydrated] = useState(false)

    useEffect(() => {
        posthog.init('sTMFPsFhdP1Ssg', {
            api_host: 'https://us.i.posthog.com',
            defaults: '2025-05-24',
        })

        setHydrated(true)
    }, [])

    if (!hydrated) return <>{children}</>
    return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
