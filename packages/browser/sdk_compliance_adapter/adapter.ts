/**
 * PostHog Browser SDK Compliance Adapter
 *
 * Wraps the posthog-js browser SDK for compliance testing using jsdom.
 */

import express, { Request, Response } from 'express'
import 'jsdom-global/register'
import { PostHog } from '../src/posthog-core'

const app = express()
app.use(express.json())

interface CapturedEvent {
    event: string
    properties: Record<string, any>
    timestamp?: string
    uuid?: string
}

interface AdapterState {
    posthog: PostHog | null
    capturedEvents: CapturedEvent[]
    totalEventsSent: number
    requestsMade: RequestInfo[]
}

interface RequestInfo {
    timestamp_ms: number
    status_code: number
    retry_attempt: number
    event_count: number
    uuid_list: string[]
}

const state: AdapterState = {
    posthog: null,
    capturedEvents: [],
    totalEventsSent: 0,
    requestsMade: [],
}

// Mock fetch to intercept SDK requests
const originalFetch = global.fetch
global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const urlString = url.toString()

    // Let requests through but track them
    const response = await originalFetch(url, init)

    // Track the request if it's to our mock server
    if (urlString.includes('/batch') || urlString.includes('/e')) {
        const body = init?.body ? JSON.parse(init.body as string) : null
        const events = body?.batch || (body ? [body] : [])

        state.requestsMade.push({
            timestamp_ms: Date.now(),
            status_code: response.status,
            retry_attempt: 0,
            event_count: events.length,
            uuid_list: events.map((e: any) => e.uuid).filter(Boolean),
        })

        if (response.status === 200) {
            state.totalEventsSent += events.length
        }
    }

    return response
}

app.get('/health', (req: Request, res: Response) => {
    res.json({
        sdk_name: 'posthog-js',
        sdk_version: require('../package.json').version,
        adapter_version: '1.0.0',
    })
})

app.post('/init', (req: Request, res: Response) => {
    const { api_key, host, flush_at, flush_interval_ms } = req.body

    // Reset state
    if (state.posthog) {
        // PostHog doesn't have a clean shutdown method, just create new instance
        state.posthog = null
    }

    state.capturedEvents = []
    state.totalEventsSent = 0
    state.requestsMade = []

    // Create new PostHog instance
    state.posthog = new PostHog()
    state.posthog.init(api_key, {
        api_host: host,
        // Use before_send to capture events
        before_send: (event) => {
            state.capturedEvents.push({
                event: event.event || '',
                properties: event.properties || {},
                timestamp: event.timestamp,
                uuid: event.uuid,
            })
            return event
        },
        persistence: 'memory', // Use memory storage, not localStorage
        _capture_metrics: false,
        disable_session_recording: true,
        disable_surveys: true,
        autocapture: false,
        // Test-friendly settings
        ...(flush_at && { _batch_size: flush_at }),
        ...(flush_interval_ms && { _flush_interval: flush_interval_ms }),
    })

    res.json({ success: true })
})

app.post('/capture', (req: Request, res: Response) => {
    if (!state.posthog) {
        return res.status(400).json({ error: 'SDK not initialized' })
    }

    const { distinct_id, event, properties, timestamp } = req.body

    if (!distinct_id || !event) {
        return res.status(400).json({ error: 'distinct_id and event are required' })
    }

    try {
        // Set distinct_id if provided
        if (distinct_id) {
            state.posthog.register({ distinct_id })
        }

        // Capture event
        state.posthog.capture(event, {
            ...properties,
            ...(timestamp && { timestamp: new Date(timestamp) }),
        })

        // Get UUID from last captured event
        const lastEvent = state.capturedEvents[state.capturedEvents.length - 1]

        res.json({ success: true, uuid: lastEvent?.uuid || 'generated-uuid' })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
})

app.post('/flush', async (req: Request, res: Response) => {
    // The browser SDK doesn't have an explicit flush method
    // Wait a bit for the batch interval to trigger
    await new Promise((resolve) => setTimeout(resolve, 500))

    res.json({ success: true, events_flushed: state.totalEventsSent })
})

app.get('/state', (req: Request, res: Response) => {
    const pendingEvents = state.capturedEvents.length - state.totalEventsSent

    res.json({
        pending_events: Math.max(0, pendingEvents),
        total_events_captured: state.capturedEvents.length,
        total_events_sent: state.totalEventsSent,
        total_retries: 0, // TODO: Track retries
        last_error: null,
        requests_made: state.requestsMade,
    })
})

app.post('/reset', (req: Request, res: Response) => {
    if (state.posthog) {
        state.posthog.reset()
    }

    state.capturedEvents = []
    state.totalEventsSent = 0
    state.requestsMade = []

    res.json({ success: true })
})

const port = process.env.PORT || 8080
app.listen(port, () => {
    console.log(`PostHog Browser SDK adapter listening on port ${port}`)
})
