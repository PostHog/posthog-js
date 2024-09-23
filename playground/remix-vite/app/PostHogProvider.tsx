import { posthog } from 'posthog-js'
import type { PostHogConfig, PostHog } from 'posthog-js'
import { createContext, useContext, useEffect, useState } from 'react'

const PostHogContext = createContext<PostHog | void>(undefined)

const PostHogProvider = ({
    MSW,
    children,
    options,
    apiKey,
}: {
    MSW?: string
    children: React.ReactNode
    options: Partial<PostHogConfig>
    apiKey: string | undefined
}) => {
    const [postHogInstance, setPostHogInstance] = useState<PostHog | void>(undefined)

    useEffect(() => {
        if (MSW === 'true') {
            return
        }
        const posthogInstance = posthog.init(apiKey ?? '', options)
        setPostHogInstance(posthogInstance)
    }, [apiKey, options, setPostHogInstance, MSW])

    return <PostHogContext.Provider value={postHogInstance}>{children}</PostHogContext.Provider>
}

const usePostHog = () => useContext(PostHogContext)

export { PostHogProvider, usePostHog }
