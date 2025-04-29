import { defineNuxtPlugin, useRuntimeConfig, useRouter, nextTick } from '#imports'

import posthog from 'posthog-js'
export default defineNuxtPlugin((nuxtApp) => {
    const runtimeConfig = useRuntimeConfig()
    const posthogClient = posthog.init(runtimeConfig.public.posthogPublicKey, {
        api_host: runtimeConfig.public.posthogHost,
        capture_pageview: false, // we add manual pageview capturing below
        capture_pageleave: true, // automatically capture a pageleave event when the user leaves the site or closes the tab
        loaded: (posthog) => {
            if (import.meta.env.MODE === 'development') posthog.debug()
        },
    })

    // Capture rendering errors
    nuxtApp.hook('vue:error', (error) => {
        posthogClient.captureException(error)
    })

    // Make sure that pageviews are captured with each route change
    const router = useRouter()
    router.afterEach((to) => {
        nextTick(() => {
            posthog.capture('$pageview', {
                current_url: to.fullPath,
            })
        })
    })

    return {
        provide: {
            posthog: () => posthogClient,
        },
    }
})
