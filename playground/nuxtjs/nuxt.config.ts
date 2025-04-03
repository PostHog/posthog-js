// Keep in sync with https://github.com/PostHog/posthog.com/blob/master/contents/docs/integrate/_snippets/install-nuxt.mdx
export default defineNuxtConfig({
    runtimeConfig: {
        public: {
            posthogPublicKey: '<ph_project_api_key>',
            posthogHost: '<ph_client_api_host>',
        },
    },

    compatibilityDate: '2025-03-04',
})
