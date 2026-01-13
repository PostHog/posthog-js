import { createApp } from 'vue'
import App from './App.vue'
import { posthog } from 'posthog-js'

posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'http://localhost:8010/',
    defaults: '2025-12-11',
})

createApp(App).mount('#app')
