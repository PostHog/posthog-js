import Head from 'next/head'

export default function Home() {
    return (
        <>
            <Head>
                <title>PostHog State Management Examples</title>
                <meta name="description" content="Compare PostHog logging with Redux vs Kea" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link rel="icon" href="/favicon.ico" />
            </Head>
            <div className="container">
                <h1>PostHog State Management Examples</h1>
                <p style={{ textAlign: 'center', color: '#666', marginBottom: '2rem' }}>
                    Compare PostHog logging with different state management libraries
                </p>

                <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <div className="example-card">
                        <h3>Redux Example</h3>
                        <p>
                            Todo list with Redux Toolkit and <code>posthogReduxLogger</code>
                        </p>
                        <ul style={{ textAlign: 'left', margin: '1rem 0' }}>
                            <li>Redux Toolkit store</li>
                            <li>Middleware integration</li>
                            <li>Action/state masking</li>
                            <li>Rate limiting</li>
                            <li>Performance monitoring</li>
                        </ul>
                        <a href="/redux" className="example-button">
                            Try Redux Version →
                        </a>
                    </div>

                    <div className="example-card">
                        <h3>Kea Example</h3>
                        <p>
                            Todo list with Kea and <code>posthogKeaLogger</code>
                        </p>
                        <ul style={{ textAlign: 'left', margin: '1rem 0' }}>
                            <li>Kea logic stores</li>
                            <li>Plugin integration</li>
                            <li>Cleaner API (maskAction/maskState)</li>
                            <li>Same rate limiting & features</li>
                            <li>Performance monitoring</li>
                        </ul>
                        <a href="/kea" className="example-button">
                            Try Kea Version →
                        </a>
                    </div>
                </div>

                <div
                    style={{
                        marginTop: '3rem',
                        padding: '1.5rem',
                        background: '#f8f9fa',
                        borderRadius: '8px',
                        border: '1px solid #e9ecef',
                    }}
                >
                    <h4 style={{ marginBottom: '1rem', color: '#333' }}>🧑‍💻 Developer Notes</h4>
                    <ul style={{ textAlign: 'left', color: '#666' }}>
                        <li>
                            <strong>Console Logging:</strong> Open browser dev tools to see PostHog action logging
                        </li>
                        <li>
                            <strong>API Comparison:</strong> Redux uses <code>maskReduxAction</code>/
                            <code>maskReduxState</code>
                        </li>
                        <li>
                            <strong>Kea Cleaner API:</strong> Kea uses <code>maskAction</code>/<code>maskState</code>
                        </li>
                        <li>
                            <strong>Same Features:</strong> Both support rate limiting, state diffing, and performance
                            monitoring
                        </li>
                        <li>
                            <strong>Integration:</strong> Kea logger reuses Redux logger internally via middleware
                            injection
                        </li>
                    </ul>
                </div>
            </div>
        </>
    )
}
