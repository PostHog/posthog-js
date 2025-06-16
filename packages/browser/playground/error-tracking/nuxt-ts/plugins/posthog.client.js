import { defineNuxtPlugin, useRuntimeConfig, useRouter, nextTick } from '#imports'

import posthog from 'posthog-js'
export default defineNuxtPlugin((nuxtApp) => {
    const runtimeConfig = useRuntimeConfig()
    const posthogClient = posthog.init(runtimeConfig.public.posthogPublicKey, {
        api_host: runtimeConfig.public.posthogHost,
        capture_pageview: 'history_change',
        loaded: (posthog) => {
            if (import.meta.env.MODE === 'development') posthog.debug()
        },
    })

    // Capture rendering errors
    nuxtApp.hook('vue:error', (error) => {
        posthogClient.captureException(error)
    })

    return {
        provide: {
            posthog: () => posthogClient,
        },
    }
})
