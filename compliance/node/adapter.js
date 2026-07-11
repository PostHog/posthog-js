/**
 * PostHog Node SDK Compliance Adapter
 *
 * Wraps the posthog-node SDK for compliance testing.
 */

const express = require('express')
const { PostHog } = require('../packages/node/dist/entrypoints/index.node')

const app = express()
app.use(express.json())

// Capture mode is fixed per adapter process (baked into the image via env) so the
// harness runs exactly one capture contract against it: v1 advertises capture_v1,
// otherwise capture_v0.
const CAPTURE_MODE = process.env.POSTHOG_CAPTURE_MODE === 'v1' ? 'v1' : 'v0'

// Harness EventOptions -> posthog-node sentinel properties. The SDK lifts these
// sentinels out of properties into the v1 event `options` object.
const OPTION_SENTINELS = {
    cookieless_mode: '$cookieless_mode',
    disable_skew_correction: '$ignore_sent_at',
    process_person_profile: '$process_person_profile',
    product_tour_id: '$product_tour_id',
}

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
        // v1 mode routes $ai_* events to a separate queue; clear it too so they can't
        // leak into the next scenario.
        client.setPersistedProperty?.('ai_queue', [])
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
        capabilities: CAPTURE_MODE === 'v1' ? ['capture_v1', 'encoding_gzip'] : ['capture_v0', 'encoding_gzip'],
    })
})

app.post('/init', async (req, res) => {
    const {
        api_key,
        host,
        flush_at,
        flush_interval_ms,
        max_retries,
        enable_compression,
        disable_geoip,
        historical_migration,
    } = req.body

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
        // Respect the harness batch-size configuration, including flush_at: 1
        // for auto-flush compliance tests. Default to 2 only when omitted so
        // ad-hoc single-event captures wait for an explicit /flush call.
        flushAt: flush_at ?? 2,
        flushInterval: flush_interval_ms ?? 100,
        fetchRetryCount: max_retries ?? 3,
        // Keep v1 partial-retry backoff short so retry compliance tests stay well
        // within their wait windows (the mock also sends Retry-After: 1s).
        fetchRetryDelay: CAPTURE_MODE === 'v1' ? 250 : undefined,
        disableCompression: enable_compression === undefined ? undefined : !enable_compression,
        disableGeoip: disable_geoip ?? false,
        historicalMigration: historical_migration ?? undefined,
        // Capture V1 opt-in is env-var-only: the SDK reads POSTHOG_CAPTURE_MODE
        // (set by docker-compose / Dockerfile.v1) itself, so no option is passed.
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

    const { distinct_id, event, properties, timestamp, options } = req.body

    if (!distinct_id || !event) {
        return res.status(400).json({ error: 'distinct_id and event are required' })
    }

    try {
        // Translate harness EventOptions into the SDK's sentinel properties; the SDK
        // lifts them into the v1 event `options` object (no-op in v0 mode).
        const mergedProperties = { ...(properties || {}) }
        if (options && typeof options === 'object') {
            for (const [optionKey, sentinel] of Object.entries(OPTION_SENTINELS)) {
                if (Object.prototype.hasOwnProperty.call(options, optionKey)) {
                    mergedProperties[sentinel] = options[optionKey]
                }
            }
        }

        // Capture event
        state.client.capture({
            distinctId: distinct_id,
            event,
            properties: mergedProperties,
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

    const sentBeforeFlush = state.totalEventsSent

    try {
        await state.client.flush()
        res.json({ success: true, events_flushed: state.totalEventsSent })
    } catch (error) {
        // The harness deliberately configures mock-server failures for retry
        // assertions. Treat SDK flush rejections as a completed adapter action
        // so the harness can inspect the outbound requests it caused.
        state.lastError = error.message
        res.json({
            success: false,
            events_flushed: Math.max(0, state.totalEventsSent - sentBeforeFlush),
            error: error.message,
        })
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
