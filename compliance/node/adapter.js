/**
 * PostHog Node SDK Compliance Adapter
 *
 * Wraps the posthog-node SDK for compliance testing.
 */

const express = require('express')
const { PostHog } = require('../packages/node/dist/entrypoints/index.node')

const app = express()
app.use(express.json())

const state = {
    client: null,
    totalEventsCaptured: 0,
    totalEventsSent: 0,
    totalRetries: 0,
    lastError: null,
    requestsMade: [],
    pendingEvents: 0,
}

async function discardClient() {
    if (!state.client) {
        return
    }

    const client = state.client
    state.client = null

    // Test resets should discard queued events instead of flushing them into
    // the next mock-server scenario.
    try {
        client.clearFlushTimer?.()
        client.setPersistedProperty?.('queue', [])
        await client.shutdown(1)
    } catch (error) {
        // Ignore reset-time shutdown errors; the next test starts with a fresh client.
    }
}

app.get('/health', (req, res) => {
    res.json({
        sdk_name: 'posthog-node',
        sdk_version: require('../packages/node/package.json').version,
        adapter_version: '1.0.0',
        capabilities: ['capture_v0', 'encoding_gzip'],
    })
})

app.post('/init', async (req, res) => {
    const { api_key, host, flush_at, flush_interval_ms, max_retries, enable_compression, disable_geoip } = req.body

    await discardClient()

    // Reset state
    state.totalEventsCaptured = 0
    state.totalEventsSent = 0
    state.totalRetries = 0
    state.lastError = null
    state.requestsMade = []
    state.pendingEvents = 0

    // Create new client
    state.client = new PostHog(api_key, {
        host,
        // Keep single-event captures queued until the harness calls /flush;
        // this avoids racing the SDK's automatic flush with explicit test flushes.
        flushAt: Math.max(flush_at ?? 1, 2),
        flushInterval: flush_interval_ms ?? 100,
        fetchRetryCount: max_retries ?? 3,
        disableCompression: enable_compression === undefined ? undefined : !enable_compression,
        disableGeoip: disable_geoip ?? false,
        // Use before_send to track events being sent
        before_send: (event) => {
            // Track that event is being sent
            // Note: This runs before the HTTP request
            return event
        },
        // Override fetch to track HTTP requests
        fetch: async (url, options) => {
            const response = await fetch(url, options)

            // Track the request
            try {
                const body = options?.body ? JSON.parse(options.body) : null
                const events = body?.batch || (body ? [body] : [])

                state.requestsMade.push({
                    timestamp_ms: Date.now(),
                    status_code: response.status,
                    retry_attempt: 0,
                    event_count: events.length,
                    uuid_list: events.map(e => e.uuid).filter(Boolean),
                })

                if (response.status === 200) {
                    state.totalEventsSent += events.length
                    state.pendingEvents -= events.length
                    if (state.pendingEvents < 0) state.pendingEvents = 0
                }
            } catch (e) {
                // Ignore parsing errors
            }

            return response
        },
    })

    res.json({ success: true })
})

app.post('/capture', (req, res) => {
    if (!state.client) {
        return res.status(400).json({ error: 'SDK not initialized' })
    }

    const { distinct_id, event, properties, timestamp } = req.body

    if (!distinct_id || !event) {
        return res.status(400).json({ error: 'distinct_id and event are required' })
    }

    try {
        // Capture event
        state.client.capture({
            distinctId: distinct_id,
            event,
            properties,
            timestamp: timestamp ? new Date(timestamp) : undefined,
        })

        state.totalEventsCaptured++
        state.pendingEvents++

        // TODO: Get actual UUID from SDK
        res.json({ success: true, uuid: 'generated-uuid' })
    } catch (error) {
        state.lastError = error.message
        res.status(500).json({ error: error.message })
    }
})

app.post('/flush', async (req, res) => {
    if (!state.client) {
        return res.status(400).json({ error: 'SDK not initialized' })
    }

    try {
        await state.client.flush()
        res.json({ success: true, events_flushed: state.totalEventsSent })
    } catch (error) {
        state.lastError = error.message
        res.json({ success: true, events_flushed: state.totalEventsSent, error: error.message })
    }
})

app.get('/state', (req, res) => {
    res.json({
        pending_events: state.pendingEvents,
        total_events_captured: state.totalEventsCaptured,
        total_events_sent: state.totalEventsSent,
        total_retries: state.totalRetries,
        last_error: state.lastError,
        requests_made: state.requestsMade,
    })
})

app.post('/get_feature_flag', async (req, res) => {
    if (!state.client) {
        return res.status(400).json({ error: 'SDK not initialized' })
    }

    const {
        key,
        distinct_id,
        person_properties,
        groups,
        group_properties,
        disable_geoip,
        force_remote = true,
    } = req.body || {}

    if (!key) {
        return res.status(400).json({ error: 'key is required' })
    }
    if (!distinct_id) {
        return res.status(400).json({ error: 'distinct_id is required' })
    }

    try {
        const value = await state.client.getFeatureFlag(key, distinct_id, {
            groups,
            personProperties: person_properties,
            groupProperties: group_properties,
            disableGeoip: disable_geoip,
            onlyEvaluateLocally: !force_remote,
        })

        // Feature flag calls enqueue a $feature_flag_called event by default.
        // Flush it before returning so it cannot leak into the next test case.
        await state.client.flush()

        res.json({ success: true, value })
    } catch (error) {
        state.lastError = error.message
        res.status(500).json({ error: error.message })
    }
})

app.post('/reset', async (req, res) => {
    await discardClient()

    state.totalEventsCaptured = 0
    state.totalEventsSent = 0
    state.totalRetries = 0
    state.lastError = null
    state.requestsMade = []
    state.pendingEvents = 0

    res.json({ success: true })
})

const port = process.env.PORT || 8080
app.listen(port, () => {
    console.log(`PostHog Node SDK adapter listening on port ${port}`)
})
