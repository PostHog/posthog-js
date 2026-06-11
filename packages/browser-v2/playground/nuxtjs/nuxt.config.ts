// Keep in sync with https://github.com/PostHog/posthog.com/blob/master/contents/docs/integrate/_snippets/install-nuxt.mdx
export default defineNuxtConfig({
    runtimeConfig: {
        public: {
            posthogPublicKey: process.env.NUXT_PUBLIC_POSTHOG_KEY || '<ph_project_api_key>',
            posthogHost: process.env.NUXT_PUBLIC_POSTHOG_HOST || '<ph_client_api_host>',
        },
    },

    compatibilityDate: '2025-03-04',
})
