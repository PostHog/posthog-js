import { lazy, Suspense } from 'react'

const ErrorButton = lazy(() => import('./error-button'))

function App() {
    return (
        <div
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100vw' }}
        >
            <Suspense fallback={<div>Loading...</div>}>
                <ErrorButton />
            </Suspense>
        </div>
    )
}

export default App
