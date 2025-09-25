export default defineNuxtConfig({
  modules: ['../src/module'],
  devtools: { enabled: true },

  sourcemap: { client: 'hidden' },
  posthog: {
    host: 'https://changed.i.posthog.com',
  },
})
