import { usePostHog } from 'posthog-js/react'
import { useEffect, useState } from 'react'

interface SessionState {
    sessionId: string | null
    activityTime: string | null
    startTime: string | null
    sessionAge: string | null
}

export function SessionInteractions() {
    const posthog = usePostHog()
    const [sessionState, setSessionState] = useState<SessionState | null>(null)

    useEffect(() => {
        const refresh = () => {
            const persistence = (posthog as any)?.persistence
            const sesid = persistence?.props?.$sesid // [activityTs, sessionId, startTs]
            const activityTs = sesid?.[0]
            const sessionId = sesid?.[1]
            const startTs = sesid?.[2]

            setSessionState({
                sessionId,
                activityTime: activityTs ? new Date(activityTs).toISOString() : null,
                startTime: startTs ? new Date(startTs).toISOString() : null,
                sessionAge: startTs ? `${((Date.now() - startTs) / 1000 / 60 / 60).toFixed(2)} hours` : null,
            })
        }

        refresh()
        const t = setInterval(refresh, 1000)

        return () => {
            clearInterval(t)
        }
    }, [posthog])

    return (
        <div className="border-2 border-dashed border-orange-400 rounded p-4 my-4">
            <h2 className="mt-0">Session interactions</h2>
            <p className="text-sm text-gray-500 italic mb-2">Modifies session persistence to test session rotation</p>
            <div className="flex items-center gap-2 flex-wrap">
                <button
                    onClick={() => {
                        const persistence = (posthog as any).persistence
                        const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000
                        const currentSesid = persistence?.props?.$sesid

                        if (persistence && currentSesid) {
                            const sessionId = currentSesid[1]
                            persistence.register({
                                $sesid: [Date.now(), sessionId, twentyFiveHoursAgo],
                            })
                        }
                    }}
                >
                    Set session start to 25 hours ago
                </button>
                <button
                    onClick={() => {
                        const persistence = (posthog as any).persistence
                        const thirtyFiveMinutesAgo = Date.now() - 35 * 60 * 1000
                        const currentSesid = persistence?.props?.$sesid

                        if (persistence && currentSesid) {
                            const sessionId = currentSesid[1]
                            const startTs = currentSesid[2]
                            persistence.register({
                                $sesid: [thirtyFiveMinutesAgo, sessionId, startTs],
                            })
                        }
                    }}
                >
                    Set last activity to 35 mins ago
                </button>
            </div>
            <pre className="text-xs bg-gray-100 rounded border border-gray-300 p-2 mt-2 overflow-auto max-h-48">
                {sessionState ? JSON.stringify(sessionState, null, 2) : 'Loading...'}
            </pre>
        </div>
    )
}
