// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@posthog/nuxt'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  sourcemap: { client: 'hidden' },
  nitro: {
    rollupConfig: {
      output: {
        sourcemapExcludeSources: false,
      },
    },
  },
  posthogConfig: {
    host: 'http://localhost:8010',
    publicKey: process.env.POSTHOG_PROJECT_API_KEY!,
    debug: true,
    clientConfig: {
      capture_exceptions: true,
    },
    serverConfig: {
      enableExceptionAutocapture: true,
    },
    sourcemaps: {
      enabled: true,
      version: '3',
      envId: '1',
      project: 'my-project',
      personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY!,
    },
  },
})
