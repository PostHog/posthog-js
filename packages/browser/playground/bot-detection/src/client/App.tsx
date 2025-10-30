import { useState, useEffect } from 'react'
import { CapturedEvent } from './types'
import { ControlBar } from './components/ControlBar'
import { EventLog } from './components/EventLog'

interface AppProps {
    token: string
    apiHost: string
    uiHost: string
    initialUserAgent: string
}

export function App({ token, apiHost, uiHost, initialUserAgent }: AppProps) {
    const [events, setEvents] = useState<CapturedEvent[]>([])
    const [eventIdCounter, setEventIdCounter] = useState(0)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, setSelectedBotInfo] = useState<{ ua: string | null; name: string | null }>({
        ua: null,
        name: null,
    })

    useEffect(() => {
        // Initialize PostHog
        if (window.posthog) {
            window.posthog.init(token, {
                api_host: apiHost,
                ui_host: uiHost,
                __preview_capture_bot_pageviews: true,
                autocapture: false,
                before_send: function (event: any) {
                    const eventData: CapturedEvent = {
                        id: eventIdCounter + 1,
                        timestamp: new Date(),
                        event: event.event,
                        properties: event.properties || {},
                        options: {},
                    }

                    setEventIdCounter((prev) => prev + 1)
                    setEvents((prev) => {
                        const newEvents = [...prev, eventData]
                        if (newEvents.length > 100) {
                            newEvents.shift()
                        }
                        return newEvents
                    })

                    return event
                },
                loaded: function (ph: any) {
                    console.log('PostHog loaded successfully!')
                    ph.debug()
                },
            })
        }

        console.log('Current User Agent:', navigator.userAgent)
    }, [token, apiHost, uiHost, eventIdCounter])

    const handleSendPageview = () => {
        if (window.posthog) {
            window.posthog.capture('$pageview', {
                $current_url: window.location.href,
            })
        }
    }

    const handleSendCustomEvent = () => {
        if (window.posthog) {
            window.posthog.capture('custom_event', {
                test: 'data',
                timestamp: new Date().toISOString(),
                random: Math.random().toString(36).substring(7),
            })
        }
    }

    const handleClearEvents = () => {
        setEvents([])
    }

    const handleBotSelect = (botUA: string | null, botName: string | null) => {
        setSelectedBotInfo({ ua: botUA, name: botName })
        if (botUA) {
            console.log('Selected Bot UA (for reference):', botUA)
        } else {
            console.log('No bot selected')
        }
    }

    return (
        <div className="container">
            <ControlBar
                userAgent={initialUserAgent}
                onSendPageview={handleSendPageview}
                onSendCustomEvent={handleSendCustomEvent}
                onBotSelect={handleBotSelect}
            />
            <EventLog events={events} onClear={handleClearEvents} />
        </div>
    )
}
