'use client'

import posthogJs, { PostHog } from 'posthog-js'
import { PostHogErrorBoundary } from 'posthog-js/react'
import { useEffect, useState } from 'react'

export default function LocalProvider({ debug, children }: { debug: boolean; children: React.ReactNode }) {
    const [client, setClient] = useState<PostHog | undefined>()

    useEffect(() => {
        const posthog = posthogJs.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || '', {
            api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
        })
        if (debug) {
            posthog.debug()
        }
        setClient(posthog)
    }, [setClient])

    return (
        <PostHogErrorBoundary
            client={client}
            fallback={<div>An error occurred while rendering the page and exception was captured</div>}
            additionalProperties={{
                hello: 'world',
            }}
        >
            {children}
        </PostHogErrorBoundary>
    )
}
