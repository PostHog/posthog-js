// Keep in sync with https://github.com/PostHog/posthog.com/blob/master/contents/docs/integrate/_snippets/install-nuxt.mdx
import { defineNuxtPlugin, useRuntimeConfig } from '#imports'

import posthog from 'posthog-js'
export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig()
    const posthogClient = posthog.init(runtimeConfig.public.posthogPublicKey, {
        api_host: runtimeConfig.public.posthogHost,
        capture_pageview: 'history_change',
        loaded: (posthog) => {
            if (import.meta.env.MODE === 'development') posthog.debug()
        },
    })

    return {
        provide: {
            posthog: () => posthogClient,
        },
    }
})
