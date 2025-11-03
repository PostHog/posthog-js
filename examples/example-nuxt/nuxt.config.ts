// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@posthog/nuxt'],
  compatibilityDate: '2025-11-03',
  posthogConfig: {
    host: process.env.POSTHOG_API_HOST!,
    publicKey: process.env.POSTHOG_PROJECT_API_KEY!,
    debug: true,
    clientConfig: {
      capture_exceptions: true,
      capture_pageview: 'history_change',
    },
    serverConfig: {
      enableExceptionAutocapture: true,
    },
    sourcemaps: {
      enabled: true,
      version: '3',
      envId: process.env.POSTHOG_API_PROJECT!,
      project: 'my-project',
      personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY!,
    },
  },
})
