import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app.tsx'
import { posthog } from 'posthog-js'

posthog.init(import.meta.env.VITE_POSTHOG_KEY || '', {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'http://localhost:8010',
    autocapture: false,
})

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
)
