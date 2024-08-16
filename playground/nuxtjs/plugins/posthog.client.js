// plugins/posthog.client.js
import { defineNuxtPlugin } from '#imports'
import posthog from 'posthog-js'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default defineNuxtPlugin((nuxtApp) => {
    // eslint-disable-next-line no-undef
    const runtimeConfig = useRuntimeConfig()
    const postHogClient = posthog.init(runtimeConfig.public.posthogPublicKey, {
        api_host: runtimeConfig.public.posthogHost || 'https://us.i.posthog.com',
        flags_api_host: runtimeConfig.public.posthogFlagsHost || undefined,
        loaded: (posthog) => {
            if (import.meta.env.MODE === 'development') posthog.debug()
        },
    })

    // Make sure that pageviews are captured with each route change
    const router = useRouter() // eslint-disable-line no-undef
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
