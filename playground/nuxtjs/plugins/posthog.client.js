// plugins/posthog.client.js
import { defineNuxtPlugin } from '#app'
import posthog from 'posthog-js'
export default defineNuxtPlugin((nuxtApp) => {
    const runtimeConfig = useRuntimeConfig()
    const postHogClient = posthog.init(runtimeConfig.public.posthogPublicKey, {
        api_host: runtimeConfig.public.posthogHost || 'https://app.posthog.com',
        loaded: (posthog) => {
            if (import.meta.env.MODE === 'development') posthog.debug()
        },
    })

    // Make sure that pageviews are captured with each route change
    const router = useRouter()
    router.afterEach((to) => {
        posthog.capture('$pageview', {
            current_url: to.fullPath,
        })
    })

    return {
        provide: {
            posthog: () => postHogClient,
        },
    }
})
