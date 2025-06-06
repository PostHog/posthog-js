import { execSync } from 'child_process'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2025-03-04',
    devtools: { enabled: true },
    sourcemap: { client: true },
    runtimeConfig: {
        public: {
            posthogPublicKey: process.env.NUXT_PUBLIC_POSTHOG_KEY || '<project_token>',
            posthogHost: process.env.NUXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
        },
    },
    hooks: {
        'nitro:build:public-assets': async () => {
            console.log('Running PostHog sourcemap injection...')
            try {
                execSync("posthog-cli sourcemap inject --directory '.output/public'", {
                    stdio: 'inherit',
                })
                console.log('PostHog sourcemap injection completed successfully')
            } catch (error) {
                console.error('PostHog sourcemap injection failed:', error)
            }
        },
    },
})
