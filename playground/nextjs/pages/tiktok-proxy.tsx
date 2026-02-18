/* eslint-disable no-console */
import { usePostHog } from 'posthog-js/react'
import { useState, useCallback } from 'react'

/**
 * Simulates TikTok's in-app browser Proxy behavior.
 *
 * TikTok's WebView injects a script that wraps `window.posthog` with a
 * JavaScript Proxy. The Proxy intercepts known analytics method calls
 * (capture, identify, getFeatureFlag, isFeatureEnabled, has_opted_out_capturing,
 * etc.) and converts them into `target.push([methodName, ...args])` calls.
 *
 * This creates an infinite recursion loop:
 *   _execute_array -> this[method] -> Proxy intercept -> push() ->
 *   _execute_array -> this[method] -> Proxy intercept -> push() -> ...
 *
 * The Proxy does NOT intercept internal/private methods like push, _execute_array,
 * config, etc. — only well-known analytics API methods.
 */
function wrapWithTikTokProxy(): { interceptCount: number } {
    const state = { interceptCount: 0 }

    const target = (window as any).posthog
    if (!target || target.__tiktokProxied) {
        return state
    }

    // Methods that TikTok's Proxy intercepts (based on the stack traces)
    const interceptedMethods = new Set([
        'capture',
        'identify',
        'alias',
        'getFeatureFlag',
        'isFeatureEnabled',
        'getFeatureFlagPayload',
        'has_opted_out_capturing',
        'opt_out_capturing',
        'opt_in_capturing',
        'register',
        'register_once',
        'unregister',
        'set_config',
        'people',
    ])

    const proxy = new Proxy(target, {
        get(obj, prop, receiver) {
            const value = Reflect.get(obj, prop, receiver)

            // Only intercept known analytics methods
            if (typeof prop === 'string' && interceptedMethods.has(prop) && typeof value === 'function') {
                return function (this: any, ...args: any[]) {
                    state.interceptCount++
                    console.log(`[TikTok Proxy] Intercepted: ${prop}(`, ...args, ')')
                    // This is what TikTok's Proxy does: convert the method call
                    // into a push() call, mimicking the pre-load snippet behavior
                    proxy.push([prop].concat(Array.prototype.slice.call(args, 0)))
                }
            }

            return value
        },
    })

    proxy.__tiktokProxied = true
    ;(window as any).posthog = proxy

    return state
}

export default function TikTokProxyPage() {
    const posthog = usePostHog()
    const [log, setLog] = useState<string[]>([])
    const [proxyActive, setProxyActive] = useState(false)
    const [interceptCount, setInterceptCount] = useState(0)
    const [proxyState, setProxyState] = useState<{ interceptCount: number } | null>(null)

    const addLog = useCallback((msg: string) => {
        setLog((prev) => [...prev, `[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`])
    }, [])

    const enableProxy = useCallback(() => {
        const state = wrapWithTikTokProxy()
        setProxyState(state)
        setProxyActive(true)
        addLog('TikTok Proxy enabled — window.posthog is now wrapped')
    }, [addLog])

    const disableProxy = useCallback(() => {
        if ((window as any).posthog?.__tiktokProxied) {
            // Restore the original posthog instance
            ;(window as any).posthog = posthog
            setProxyActive(false)
            addLog('TikTok Proxy disabled — window.posthog restored')
        }
    }, [posthog, addLog])

    const refreshCount = useCallback(() => {
        if (proxyState) {
            setInterceptCount(proxyState.interceptCount)
        }
    }, [proxyState])

    const testCapture = useCallback(() => {
        try {
            addLog('Calling window.posthog.capture("test-tiktok-event")...')
            ;(window as any).posthog.capture('test-tiktok-event', { source: 'tiktok-proxy-test' })
            addLog('capture() completed without error')
        } catch (e: any) {
            addLog(`ERROR: ${e.name}: ${e.message}`)
        }
        refreshCount()
    }, [addLog, refreshCount])

    const testGetFeatureFlag = useCallback(() => {
        try {
            addLog('Calling window.posthog.getFeatureFlag("test-flag")...')
            const result = (window as any).posthog.getFeatureFlag('test-flag')
            addLog(`getFeatureFlag() returned: ${JSON.stringify(result)}`)
        } catch (e: any) {
            addLog(`ERROR: ${e.name}: ${e.message}`)
        }
        refreshCount()
    }, [addLog, refreshCount])

    const testIsFeatureEnabled = useCallback(() => {
        try {
            addLog('Calling window.posthog.isFeatureEnabled("test-flag")...')
            const result = (window as any).posthog.isFeatureEnabled('test-flag')
            addLog(`isFeatureEnabled() returned: ${JSON.stringify(result)}`)
        } catch (e: any) {
            addLog(`ERROR: ${e.name}: ${e.message}`)
        }
        refreshCount()
    }, [addLog, refreshCount])

    const testHasOptedOut = useCallback(() => {
        try {
            addLog('Calling window.posthog.has_opted_out_capturing()...')
            const result = (window as any).posthog.has_opted_out_capturing()
            addLog(`has_opted_out_capturing() returned: ${JSON.stringify(result)}`)
        } catch (e: any) {
            addLog(`ERROR: ${e.name}: ${e.message}`)
        }
        refreshCount()
    }, [addLog, refreshCount])

    const testAllMethods = useCallback(() => {
        addLog('--- Running all method tests ---')
        testCapture()
        testGetFeatureFlag()
        testIsFeatureEnabled()
        testHasOptedOut()
        addLog('--- All tests complete ---')
    }, [addLog, testCapture, testGetFeatureFlag, testIsFeatureEnabled, testHasOptedOut])

    return (
        <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>
            <h1>TikTok In-App Browser Proxy Reproduction</h1>
            <p style={{ color: '#666', maxWidth: 700 }}>
                This page simulates the behavior of TikTok&apos;s in-app browser, which wraps{' '}
                <code>window.posthog</code> with a JavaScript Proxy that converts method calls into <code>push()</code>{' '}
                calls, causing infinite recursion.
            </p>

            <div
                style={{
                    padding: 12,
                    marginBottom: 16,
                    borderRadius: 6,
                    background: proxyActive ? '#fee2e2' : '#f0fdf4',
                    border: `1px solid ${proxyActive ? '#fca5a5' : '#86efac'}`,
                }}
            >
                <strong>Proxy Status:</strong> {proxyActive ? 'ACTIVE' : 'Inactive'}
                {proxyActive && ` — ${interceptCount} interceptions`}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <button
                    onClick={enableProxy}
                    disabled={proxyActive}
                    style={{
                        padding: '8px 16px',
                        background: proxyActive ? '#ccc' : '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: proxyActive ? 'not-allowed' : 'pointer',
                    }}
                >
                    Enable TikTok Proxy
                </button>
                <button
                    onClick={disableProxy}
                    disabled={!proxyActive}
                    style={{
                        padding: '8px 16px',
                        background: !proxyActive ? '#ccc' : '#22c55e',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: !proxyActive ? 'not-allowed' : 'pointer',
                    }}
                >
                    Disable Proxy
                </button>
            </div>

            <h2>Test Methods</h2>
            <p style={{ color: '#666' }}>
                Enable the proxy above, then click these buttons. Without the fix, these will throw{' '}
                <code>RangeError: Maximum call stack size exceeded</code>.
            </p>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                <button onClick={testCapture} style={{ padding: '8px 16px' }}>
                    capture()
                </button>
                <button onClick={testGetFeatureFlag} style={{ padding: '8px 16px' }}>
                    getFeatureFlag()
                </button>
                <button onClick={testIsFeatureEnabled} style={{ padding: '8px 16px' }}>
                    isFeatureEnabled()
                </button>
                <button onClick={testHasOptedOut} style={{ padding: '8px 16px' }}>
                    has_opted_out_capturing()
                </button>
                <button
                    onClick={testAllMethods}
                    style={{
                        padding: '8px 16px',
                        background: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                    }}
                >
                    Run All
                </button>
            </div>

            <h2>Log</h2>
            <button onClick={() => setLog([])} style={{ marginBottom: 8, padding: '4px 12px' }}>
                Clear
            </button>
            <pre
                style={{
                    background: '#1e1e1e',
                    color: '#d4d4d4',
                    padding: 16,
                    borderRadius: 6,
                    maxHeight: 400,
                    overflow: 'auto',
                    fontSize: 13,
                    lineHeight: 1.5,
                }}
            >
                {log.length === 0 ? '(no log entries yet)' : log.join('\n')}
            </pre>
        </div>
    )
}
