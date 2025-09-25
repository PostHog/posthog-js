export default defineNuxtConfig({
  modules: ['../src/module'],
  devtools: { enabled: true },
  sourcemap: { client: 'hidden' },
  posthog: {
    host: 'http://localhost:8010',
    publicApiKey: 'phc_VXlGk6yOu3agIn0h7lTmSOECAGWCtJonUJDAN4CexlJ',
    sourceMaps: {
      enabled: true,
      version: 'V1',
      envId: '2',
      privateApiKey: 'phx_YZZHl8xzLkCWHSpVahmkggLGaS6gmSxCNmH26N0RUGZnqAs',
    },
  },
})
