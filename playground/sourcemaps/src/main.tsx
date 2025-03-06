import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import posthog from 'posthog-js'
import App from './App.js'

posthog.init('phc_Vle7XP9aoZ4Qm1JbVFftGAG5O7cN4oSdQRR53FkLjIm', {
    api_host: 'http://localhost:8010',
    autocapture: false,
})

const root = document.getElementById('root')
if (root) {
    createRoot(root).render(
        <StrictMode>
            <App />
        </StrictMode>
    )
}
