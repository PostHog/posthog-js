// Keep in sync with https://github.com/PostHog/posthog.com/blob/master/contents/docs/integrate/_snippets/install-nuxt.mdx
import { defineNuxtPlugin, useRuntimeConfig, useRouter, nextTick } from '#imports'

import posthog from 'posthog-js'
export default defineNuxtPlugin(() => {
    const runtimeConfig = useRuntimeConfig()
    const posthogClient = posthog.init(runtimeConfig.public.posthogPublicKey, {
        api_host: runtimeConfig.public.posthogHost,
        capture_pageview: false, // we add manual pageview capturing below
        capture_pageleave: true, // automatically capture a pageleave event when the user leaves the site or closes the tab
        loaded: (posthog) => {
            if (import.meta.env.MODE === 'development') posthog.debug()
        },
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
