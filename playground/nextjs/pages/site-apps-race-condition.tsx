import { useEffect, useState } from 'react'
import { posthog } from '@/src/posthog'

interface TimingLog {
    timestamp: number
    event: string
    details: string
}

export default function SiteAppsRaceCondition() {
    const [logs, setLogs] = useState<TimingLog[]>([])
    const [remoteConfigLoaded, setRemoteConfigLoaded] = useState(false)
    const [siteAppsCount, setSiteAppsCount] = useState(0)

    const addLog = (event: string, details: string) => {
        setLogs((prev) => [...prev, { timestamp: Date.now(), event, details }])
    }

    useEffect(() => {
        // Log initial state
        addLog('Page Loaded', 'React component mounted')

        // Check if PostHog is already loaded
        if (posthog.__loaded) {
            addLog('PostHog Already Loaded', 'posthog.__loaded = true')
        }

        // Monitor window._POSTHOG_REMOTE_CONFIG
        const checkRemoteConfig = () => {
            if (typeof window !== 'undefined') {
                const token = process.env.NEXT_PUBLIC_POSTHOG_KEY || 'test-token'
                const remoteConfig = (window as any)._POSTHOG_REMOTE_CONFIG?.[token]

                if (remoteConfig) {
                    setRemoteConfigLoaded(true)
                    const siteApps = remoteConfig.siteApps || []
                    setSiteAppsCount(siteApps.length)
                    addLog('Remote Config Found', `${siteApps.length} site app(s) in window._POSTHOG_REMOTE_CONFIG`)

                    // Log each site app
                    siteApps.forEach((app: any, index: number) => {
                        addLog(`Site App ${index + 1}`, `Has init: ${!!app.init}, Type: ${typeof app.init}`)
                    })
                }
            }
        }

        // Check immediately
        checkRemoteConfig()

        // Poll for remote config (since we don't have a direct event)
        const interval = setInterval(() => {
            if (!remoteConfigLoaded) {
                checkRemoteConfig()
            } else {
                clearInterval(interval)
            }
        }, 100)

        // Try to initialize site apps manually
        const tryManualInit = () => {
            if (typeof window !== 'undefined') {
                const token = process.env.NEXT_PUBLIC_POSTHOG_KEY || 'test-token'
                const remoteConfig = (window as any)._POSTHOG_REMOTE_CONFIG?.[token]

                if (remoteConfig?.siteApps) {
                    addLog(
                        'Manual Init Attempt',
                        `Trying to manually initialize ${remoteConfig.siteApps.length} site app(s)`
                    )

                    remoteConfig.siteApps.forEach((siteApp: any, index: number) => {
                        if (siteApp.init) {
                            try {
                                siteApp.init({
                                    posthog,
                                    callback: (success: boolean) => {
                                        addLog(`Site App ${index + 1} Init Callback`, `Success: ${success}`)
                                    },
                                })
                                addLog(`Site App ${index + 1} Init Called`, 'init() function executed')
                            } catch (error) {
                                addLog(
                                    `Site App ${index + 1} Init Error`,
                                    `Error: ${error instanceof Error ? error.message : String(error)}`
                                )
                            }
                        }
                    })
                }
            }
        }

        // Test the workaround using onFeatureFlags
        if (posthog) {
            posthog.onFeatureFlags(() => {
                addLog('onFeatureFlags Callback', 'Feature flags loaded - remote config should be available')
                checkRemoteConfig()
            })
        }

        return () => {
            clearInterval(interval)
        }
    }, [remoteConfigLoaded])

    const handleManualInit = () => {
        if (typeof window !== 'undefined') {
            const token = process.env.NEXT_PUBLIC_POSTHOG_KEY || 'test-token'
            const remoteConfig = (window as any)._POSTHOG_REMOTE_CONFIG?.[token]

            if (remoteConfig?.siteApps) {
                addLog('Manual Init Button', `Attempting to initialize ${remoteConfig.siteApps.length} site app(s)`)

                remoteConfig.siteApps.forEach((siteApp: any, index: number) => {
                    if (siteApp.init) {
                        try {
                            siteApp.init({
                                posthog,
                                callback: (success: boolean) => {
                                    addLog(`Site App ${index + 1} Callback`, `Initialized: ${success}`)
                                },
                            })
                            addLog(`Site App ${index + 1} Initialized`, 'Manual init() called successfully')
                        } catch (error) {
                            addLog(
                                `Site App ${index + 1} Error`,
                                `${error instanceof Error ? error.message : String(error)}`
                            )
                        }
                    } else {
                        addLog(`Site App ${index + 1}`, 'No init function found')
                    }
                })
            } else {
                addLog('Manual Init Failed', 'No remote config or site apps found')
            }
        }
    }

    const checkPostHogState = () => {
        addLog('PostHog State Check', `__loaded: ${posthog?.__loaded}`)

        if (typeof window !== 'undefined') {
            const token = process.env.NEXT_PUBLIC_POSTHOG_KEY || 'test-token'
            const remoteConfig = (window as any)._POSTHOG_REMOTE_CONFIG?.[token]
            addLog(
                'Remote Config State',
                `Exists: ${!!remoteConfig}, Site Apps: ${remoteConfig?.siteApps?.length || 0}`
            )
        }
    }

    return (
        <div className="container mx-auto p-8">
            <h1 className="text-3xl font-bold mb-6">Site Apps Race Condition Debugger</h1>

            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                <h2 className="text-xl font-semibold mb-2">Bug Description</h2>
                <p className="mb-2">
                    Site apps don&apos;t auto-initialize despite{' '}
                    <code className="bg-gray-100 px-1">opt_in_site_apps: true</code>
                </p>
                <p className="mb-2">
                    <strong>Root Cause:</strong> Race condition - the <code className="bg-gray-100 px-1">loaded</code>{' '}
                    callback fires before <code className="bg-gray-100 px-1">window._POSTHOG_REMOTE_CONFIG</code> is
                    populated by the /decide endpoint.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded">
                    <h3 className="font-semibold mb-2">PostHog Loaded</h3>
                    <p className="text-2xl">{posthog?.__loaded ? '✅' : '❌'}</p>
                </div>
                <div className="bg-green-50 p-4 rounded">
                    <h3 className="font-semibold mb-2">Remote Config</h3>
                    <p className="text-2xl">{remoteConfigLoaded ? '✅' : '⏳'}</p>
                </div>
                <div className="bg-purple-50 p-4 rounded">
                    <h3 className="font-semibold mb-2">Site Apps Found</h3>
                    <p className="text-2xl">{siteAppsCount > 0 ? `✅ (${siteAppsCount})` : '❌'}</p>
                </div>
            </div>

            <div className="mb-6 space-x-4">
                <button
                    onClick={handleManualInit}
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                >
                    Manually Initialize Site Apps
                </button>
                <button
                    onClick={checkPostHogState}
                    className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
                >
                    Check Current State
                </button>
            </div>

            <div className="bg-white shadow rounded p-4">
                <h2 className="text-2xl font-semibold mb-4">Timing Logs</h2>
                <div className="space-y-2 max-h-96 overflow-y-auto font-mono text-sm">
                    {logs.length === 0 ? (
                        <p className="text-gray-500">No logs yet…</p>
                    ) : (
                        logs.map((log, index) => {
                            const relativeTime = index === 0 ? 0 : log.timestamp - logs[0].timestamp
                            return (
                                <div key={index} className="border-b pb-2">
                                    <div className="flex justify-between">
                                        <span className="font-semibold">{log.event}</span>
                                        <span className="text-gray-500">+{relativeTime}ms</span>
                                    </div>
                                    <div className="text-gray-600 text-xs">{log.details}</div>
                                </div>
                            )
                        })
                    )}
                </div>
            </div>

            <div className="mt-6 bg-gray-50 p-4 rounded">
                <h2 className="text-xl font-semibold mb-2">Expected vs Actual Behavior</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <h3 className="font-semibold text-red-600 mb-2">❌ Current (Broken)</h3>
                        <ol className="list-decimal list-inside space-y-1 text-sm">
                            <li>PostHog initializes</li>
                            <li>
                                <code className="bg-gray-100 px-1">loaded</code> callback fires
                            </li>
                            <li>
                                <code className="bg-gray-100 px-1">window._POSTHOG_REMOTE_CONFIG</code> is still empty
                            </li>
                            <li>Site apps NOT initialized</li>
                            <li>Remote config loads later (too late!)</li>
                        </ol>
                    </div>
                    <div>
                        <h3 className="font-semibold text-green-600 mb-2">✅ Expected (Fixed)</h3>
                        <ol className="list-decimal list-inside space-y-1 text-sm">
                            <li>PostHog initializes</li>
                            <li>Remote config loads</li>
                            <li>
                                <code className="bg-gray-100 px-1">window._POSTHOG_REMOTE_CONFIG</code> populated
                            </li>
                            <li>Site apps auto-initialize</li>
                            <li>
                                <code className="bg-gray-100 px-1">loaded</code> callback fires
                            </li>
                        </ol>
                    </div>
                </div>
            </div>
        </div>
    )
}
