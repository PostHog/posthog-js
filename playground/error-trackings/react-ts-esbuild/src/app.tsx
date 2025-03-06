import { lazy } from 'react'

const ErrorButton = lazy(() => import('./error-button'))

function App() {
    return (
        <div
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100vw' }}
        >
            <ErrorButton />
        </div>
    )
}

export default App
