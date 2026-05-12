import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ChakraProvider, defaultSystem } from '@chakra-ui/react'
import App from './app'
import { posthog } from 'posthog-js'

posthog.init(import.meta.env.VITE_POSTHOG_KEY || 'phc_local', {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'http://localhost:8010',
    autocapture: false,
    capture_pageview: false,
    session_recording: {
        // surface the full event so we can read _cssText / textContent on snapshots
        compress_events: false,
    },
    loaded: (ph) => {
        // expose for in-browser debugging
        ;(window as any).posthog = ph
    },
})

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ChakraProvider value={defaultSystem}>
            <App />
        </ChakraProvider>
    </StrictMode>
)
