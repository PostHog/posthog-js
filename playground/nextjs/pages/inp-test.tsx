import { useCallback, useState, useEffect, useRef } from 'react'

// Simple INP measurement using web-vitals approach
function measureINP(callback: (value: number) => void) {
    if (typeof window === 'undefined') return () => {}

    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            // @ts-expect-error - interactionId is not in types yet
            if (entry.interactionId) {
                callback(entry.duration)
            }
        }
    })

    observer.observe({ type: 'event', buffered: true, durationThreshold: 0 })
    return () => observer.disconnect()
}

export default function INPTest() {
    const [clicks, setClicks] = useState(0)
    const [inpValues, setInpValues] = useState<number[]>([])
    const [isRunning, setIsRunning] = useState(false)
    const buttonRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
        return measureINP((value) => {
            setInpValues((prev) => [...prev, value])
        })
    }, [])

    const simulateClick = useCallback(() => {
        setClicks((c) => c + 1)
        // Simulate some work that PostHog would do
        const posthog = (window as any).posthog
        if (posthog) {
            posthog.capture('test_click', {
                click_number: clicks,
                timestamp: Date.now(),
            })
        }
    }, [clicks])

    const runBenchmark = useCallback(async () => {
        setIsRunning(true)
        setInpValues([])
        setClicks(0)

        // Run 50 clicks with small delays to allow measurement
        for (let i = 0; i < 50; i++) {
            buttonRef.current?.click()
            await new Promise((resolve) => setTimeout(resolve, 100))
        }

        setIsRunning(false)
    }, [])

    const avgINP = inpValues.length > 0 ? (inpValues.reduce((a, b) => a + b, 0) / inpValues.length).toFixed(2) : 'N/A'

    const maxINP = inpValues.length > 0 ? Math.max(...inpValues).toFixed(2) : 'N/A'

    const p75INP =
        inpValues.length > 0 ? inpValues.sort((a, b) => a - b)[Math.floor(inpValues.length * 0.75)]?.toFixed(2) : 'N/A'

    return (
        <div style={{ padding: '40px', fontFamily: 'system-ui' }}>
            <h1>INP (Interaction to Next Paint) Test</h1>
            <p>This page measures actual INP during user interactions with PostHog.</p>

            <div style={{ marginBottom: '20px' }}>
                <button
                    ref={buttonRef}
                    onClick={simulateClick}
                    style={{
                        padding: '20px 40px',
                        fontSize: '18px',
                        cursor: 'pointer',
                        marginRight: '10px',
                    }}
                >
                    Click Me ({clicks})
                </button>

                <button
                    onClick={runBenchmark}
                    disabled={isRunning}
                    style={{
                        padding: '20px 40px',
                        fontSize: '18px',
                        cursor: isRunning ? 'wait' : 'pointer',
                        backgroundColor: isRunning ? '#ccc' : '#4CAF50',
                        color: 'white',
                        border: 'none',
                    }}
                >
                    {isRunning ? 'Running...' : 'Run 50 Click Benchmark'}
                </button>
            </div>

            <div
                style={{
                    padding: '20px',
                    backgroundColor: '#f5f5f5',
                    borderRadius: '8px',
                    marginBottom: '20px',
                }}
            >
                <h2>Results</h2>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                        <tr>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}>Total Interactions:</td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd', fontWeight: 'bold' }}>
                                {inpValues.length}
                            </td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}>Average INP:</td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd', fontWeight: 'bold' }}>
                                {avgINP} ms
                            </td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd' }}>P75 INP:</td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #ddd', fontWeight: 'bold' }}>
                                {p75INP} ms
                            </td>
                        </tr>
                        <tr>
                            <td style={{ padding: '8px' }}>Max INP:</td>
                            <td style={{ padding: '8px', fontWeight: 'bold' }}>{maxINP} ms</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style={{ fontSize: '14px', color: '#666' }}>
                <h3>How to test:</h3>
                <ol>
                    <li>
                        Install npm version: <code>pnpm add posthog-js@latest</code>
                    </li>
                    <li>
                        Start dev server: <code>pnpm dev</code>
                    </li>
                    <li>Run the benchmark and note the INP values</li>
                    <li>
                        Install local branch: <code>pnpm add ../../packages/browser</code>
                    </li>
                    <li>Restart dev server and run benchmark again</li>
                    <li>Compare INP values</li>
                </ol>

                <h3>What is INP?</h3>
                <p>
                    INP measures responsiveness - the delay between user interaction and visual feedback. Lower is
                    better. Good: &lt;200ms, Needs improvement: 200-500ms, Poor: &gt;500ms
                </p>
            </div>
        </div>
    )
}
