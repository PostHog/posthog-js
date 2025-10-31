import { createRoot } from 'react-dom/client'
import { App } from './App'

// Get config from data attributes on the root element
const rootElement = document.getElementById('root')
if (!rootElement) {
    throw new Error('Root element not found')
}

const token = rootElement.dataset.token || 'test-key'
const apiHost = rootElement.dataset.apiHost || 'https://us.i.posthog.com'
const uiHost = rootElement.dataset.uiHost || apiHost
const userAgent = rootElement.dataset.userAgent || navigator.userAgent

const root = createRoot(rootElement)
root.render(<App token={token} apiHost={apiHost} uiHost={uiHost} initialUserAgent={userAgent} />)
