// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      posthogPublicKey: '<posthog_api_key>',
      posthogHost: '<posthog_host>'
    }
  }
})
