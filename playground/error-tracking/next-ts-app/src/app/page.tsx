'use client'

function throwException() {
    throw new Error('New Error')
}

export default function Home() {
    return (
        <div>
            <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <button onClick={() => throwException()}>Send exception</button>
            </main>
        </div>
    )
}
