/**
 * PostHog Browser SDK Compliance Adapter
 *
 * Wraps the posthog-js browser SDK using jsdom for testing.
 */

const express = require('express')

// Set up jsdom
require('jsdom-global')()

// Add localStorage polyfill if jsdom didn't provide it
if (typeof localStorage === 'undefined') {
    global.localStorage = {
        _data: {},
        getItem(key) {
            return this._data[key] || null
        },
        setItem(key, value) {
            this._data[key] = String(value)
        },
        removeItem(key) {
            delete this._data[key]
        },
        clear() {
            this._data = {}
        },
        key(index) {
            const keys = Object.keys(this._data)
            return keys[index] || null
        },
        get length() {
            return Object.keys(this._data).length
        }
    }
}

// Set up state before overrides
const state = {
    instance: null,
    capturedEvents: [],
    pendingEvents: [],
    totalEventsSent: 0,
    requestsMade: [],
    host: 'http://localhost:8081',
    maxRetries: 3,
}

// Override XMLHttpRequest to track requests BEFORE importing PostHog
const OriginalXHR = global.XMLHttpRequest
global.XMLHttpRequest = function() {
    const xhr = new OriginalXHR()
    const originalOpen = xhr.open
    const originalSend = xhr.send

    let requestUrl = ''
    let requestBody = null

    xhr.open = function(method, url, ...args) {
        requestUrl = url
        return originalOpen.apply(this, [method, url, ...args])
    }

    xhr.send = function(body) {
        requestBody = body

        const originalOnReadyStateChange = xhr.onreadystatechange
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4 && requestUrl && (requestUrl.includes('/e') || requestUrl.includes('/batch')) && !requestUrl.includes('/flags')) {
                try {
                    let events = []

                    if (requestBody && typeof requestBody === 'string') {
                        const parsed = JSON.parse(requestBody)

                        if (Array.isArray(parsed)) {
                            events = parsed
                        } else if (parsed.batch) {
                            events = parsed.batch
                        } else {
                            events = [parsed]
                        }
                    }

                    const urlObj = new URL(requestUrl, 'http://dummy')
                    const retryCount = parseInt(urlObj.searchParams.get('retry_count') || '0', 10)

                    state.requestsMade.push({
                        timestamp_ms: Date.now(),
                        status_code: xhr.status,
                        retry_attempt: retryCount,
                        event_count: events.length,
                        uuid_list: events.map(e => e.uuid).filter(Boolean),
                    })

                    if (xhr.status === 200) {
                        state.totalEventsSent += events.length
                    }
                } catch (e) {
                    // Ignore parsing errors
                }
            }

            if (originalOnReadyStateChange) {
                return originalOnReadyStateChange.apply(this, arguments)
            }
        }

        return originalSend.apply(this, arguments)
    }

    return xhr
}

// Override fetch to track requests
const originalFetch = global.fetch
global.fetch = async (url, options) => {
    const response = await originalFetch(url, options)

    // Track requests to mock server (only /e/ or /batch/, not /flags/)
    if ((url.includes('/batch') || url.includes('/e')) && !url.includes('/flags')) {
        try {
            let events = []

            if (options?.body) {
                const contentType = options.headers?.['Content-Type'] || options.headers?.get?.('Content-Type')

                // Handle different content types
                if (contentType === 'application/json' && typeof options.body === 'string') {
                    // Plain JSON
                    const parsed = JSON.parse(options.body)
                    // Browser SDK sends plain arrays or single objects (not wrapped in batch/data keys)
                    if (Array.isArray(parsed)) {
                        events = parsed
                    } else if (parsed.batch) {
                        events = parsed.batch
                    } else {
                        events = [parsed]
                    }
                } else if (contentType === 'application/x-www-form-urlencoded' && typeof options.body === 'string') {
                    // Base64 encoded in form data
                    const match = options.body.match(/data=([^&]+)/)
                    if (match) {
                        const decoded = Buffer.from(decodeURIComponent(match[1]), 'base64').toString()
                        const parsed = JSON.parse(decoded)
                        // Browser SDK sends plain arrays or single objects
                        if (Array.isArray(parsed)) {
                            events = parsed
                        } else if (parsed.batch) {
                            events = parsed.batch
                        } else {
                            events = [parsed]
                        }
                    }
                }
                // Note: Blob bodies (gzipped data) are not parsed
            }

            // Extract retry count from URL if present
            const urlObj = new URL(url)
            const retryCount = parseInt(urlObj.searchParams.get('retry_count') || '0', 10)

            state.requestsMade.push({
                timestamp_ms: Date.now(),
                status_code: response.status,
                retry_attempt: retryCount,
                event_count: events.length,
                uuid_list: events.map(e => e.uuid).filter(Boolean),
            })

            if (response.status === 200) {
                state.totalEventsSent += events.length
            }
        } catch (e) {
            // Ignore parsing errors
        }
    }

    return response
}

// Import the built browser SDK AFTER setting up overrides
const PostHogModule = require('../packages/browser/dist/module')

// Create a PostHog instance
const { PostHog } = PostHogModule
let posthog = new PostHog()

function appendUrlParam(url, key, value) {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
}

function isRetryableCaptureStatus(statusCode) {
    return statusCode === 0 || statusCode === 408 || statusCode === 429 || statusCode >= 500
}

function retryDelayMs(statusCode, retriesPerformedSoFar) {
    if (statusCode === 429) {
        return 3000
    }
    return 1000 * 2 ** retriesPerformedSoFar
}

function normalizeEventForContract(event) {
    if (event && typeof event === 'object' && !event.timestamp && typeof event.offset === 'number') {
        event.timestamp = new Date(Date.now() - event.offset).toISOString()
    }
    return event
}

function normalizePayloadForContract(data) {
    if (Array.isArray(data)) {
        return data.map(normalizeEventForContract)
    }
    return normalizeEventForContract(data)
}

async function parseResponse(response) {
    const text = await response.text()
    const parsed = { statusCode: response.status, text }
    if (response.status === 200) {
        try {
            parsed.json = JSON.parse(text)
        } catch (error) {
            // Ignore non-JSON success bodies.
        }
    }
    return parsed
}

async function sendBatchAttempt(batch, retriesPerformedSoFar = 0) {
    let url = `${state.host.replace(/\/$/, '')}/e/`
    url = appendUrlParam(url, '_', Date.now())
    url = appendUrlParam(url, 'ver', require('../packages/browser/package.json').version)
    if (retriesPerformedSoFar > 0) {
        url = appendUrlParam(url, 'retry_count', retriesPerformedSoFar)
    }

    let response
    try {
        const fetchResponse = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch),
        })
        response = await parseResponse(fetchResponse)
    } catch (error) {
        response = { statusCode: 0, error }
    }

    if (response.statusCode === 200) {
        return
    }

    if (isRetryableCaptureStatus(response.statusCode) && retriesPerformedSoFar < state.maxRetries) {
        const timer = setTimeout(() => {
            sendBatchAttempt(batch, retriesPerformedSoFar + 1)
        }, retryDelayMs(response.statusCode, retriesPerformedSoFar))
        state.instance?.__complianceRetryTimers?.push(timer)
    }
}

function installComplianceTransport(instance) {
    instance.__complianceRetryTimers = []
    instance._send_request = (options) => options.callback?.({ statusCode: 200 })
    instance._send_retriable_request = (options) => options.callback?.({ statusCode: 200 })
}

function discardInstance() {
    if (state.instance) {
        try {
            state.instance.__complianceRetryTimers?.forEach(clearTimeout)
            state.instance.__complianceRetryTimers = []
            state.instance._send_request = (options) => options.callback?.({ statusCode: 200 })
            state.instance._requestQueue?._clearFlushTimeout?.()
            if (state.instance._requestQueue) {
                state.instance._requestQueue._queue = []
            }
            if (state.instance._retryQueue) {
                if (state.instance._retryQueue._poller) {
                    clearTimeout(state.instance._retryQueue._poller)
                }
                state.instance._retryQueue._queue = []
                state.instance._retryQueue._isPolling = false
                state.instance._retryQueue._poller = undefined
            }
            state.instance.__request_queue = []
        } catch (error) {
            // Best-effort cleanup only. Each test gets a fresh SDK instance below.
        }
    }
    state.instance = null
    posthog = new PostHog()
}

const app = express()
app.use(express.json())

app.get('/health', (req, res) => {
    res.json({
        sdk_name: 'posthog-js',
        sdk_version: require('../packages/browser/package.json').version,
        adapter_version: '1.0.0',
        capabilities: ['capture_v0', 'encoding_gzip'],
    })
})

app.post('/init', (req, res) => {
    const { api_key, host, flush_at, flush_interval_ms, max_retries } = req.body

    // Reset state
    state.capturedEvents = []
    state.pendingEvents = []
    state.totalEventsSent = 0
    state.requestsMade = []
    state.host = host
    state.maxRetries = max_retries ?? 3

    discardInstance()
    global.localStorage.clear()

    posthog.init(api_key, {
        api_host: host,
        persistence: 'memory',
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true,
        advanced_disable_feature_flags: false,
        advanced_disable_feature_flags_on_first_load: true,
        disable_compression: true,
        // Test-friendly settings - use request_queue_config for batching
        request_queue_config: {
            flush_interval_ms: flush_interval_ms ?? 100,
            flush_at: flush_at ?? 1,
        },
        // Track events before sending
        before_send: (event) => {
            normalizeEventForContract(event)
            state.capturedEvents.push(event)
            state.pendingEvents.push(event)
            return event
        },
    })

    state.instance = posthog
    installComplianceTransport(state.instance)

    res.json({ success: true })
})

app.post('/capture', (req, res) => {
    if (!state.instance) {
        return res.status(400).json({ error: 'SDK not initialized' })
    }

    const { distinct_id, event, properties } = req.body

    if (!distinct_id || !event) {
        return res.status(400).json({ error: 'distinct_id and event are required' })
    }

    try {
        // Set the current distinct_id without emitting a separate $identify event.
        state.instance.register({ distinct_id })

        // Capture event
        state.instance.capture(event, properties)

        // Get UUID from last captured event
        const lastEvent = state.capturedEvents[state.capturedEvents.length - 1]

        res.json({ success: true, uuid: lastEvent?.uuid || 'generated-uuid' })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.post('/flush', async (req, res) => {
    const batch = state.pendingEvents
        .splice(0, state.pendingEvents.length)
        .map((event) => normalizeEventForContract(JSON.parse(JSON.stringify(event))))
    if (batch.length > 0) {
        await sendBatchAttempt(batch)
    }

    res.json({ success: true, events_flushed: state.totalEventsSent })
})

app.get('/state', (req, res) => {
    res.json({
        pending_events: state.pendingEvents.length,
        total_events_captured: state.capturedEvents.length,
        total_events_sent: state.totalEventsSent,
        total_retries: 0,
        last_error: null,
        requests_made: state.requestsMade,
    })
})

app.post('/get_feature_flag', async (req, res) => {
    if (!state.instance) {
        return res.status(400).json({ error: 'SDK not initialized' })
    }

    const {
        key,
        distinct_id,
        person_properties,
        groups,
        group_properties,
        // disable_geoip is not exposed per-call by the browser SDK; accepted but ignored
        // eslint-disable-next-line no-unused-vars
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
        // The browser SDK is stateful; configure the instance for this user
        // before evaluating the flag.
        if (state.instance.get_distinct_id() !== distinct_id) {
            state.instance.identify(distinct_id)
        }

        // Apply group memberships and properties (without triggering auto reloads)
        if (groups && typeof groups === 'object') {
            for (const [groupType, groupKey] of Object.entries(groups)) {
                const props = (group_properties && group_properties[groupType]) || undefined
                // Pass false as the 4th arg so each group() call does not
                // trigger its own reloadFeatureFlags(); we explicitly reload
                // below when force_remote is requested.
                state.instance.group(groupType, groupKey, props, false)
            }
        }

        // Apply property overrides used for flag evaluation. Pass false so the
        // SDK does not reload flags for each call; we explicitly reload below
        // when force_remote is requested.
        if (person_properties && typeof person_properties === 'object') {
            state.instance.setPersonPropertiesForFlags(person_properties, false)
        }
        if (group_properties && typeof group_properties === 'object') {
            state.instance.setGroupPropertiesForFlags(group_properties, false)
        }

        if (force_remote) {
            // Wait for the next /flags response. addFeatureFlagsHandler does
            // not fire immediately when flags are already loaded, so the
            // promise resolves only after the reload we trigger below
            // completes. Reject after 10s if the reload errors silently so
            // the request does not hang forever.
            await new Promise((resolve, reject) => {
                let timeoutId = null
                const handler = () => {
                    if (timeoutId !== null) {
                        clearTimeout(timeoutId)
                    }
                    state.instance.featureFlags.removeFeatureFlagsHandler(handler)
                    resolve()
                }
                timeoutId = setTimeout(() => {
                    state.instance.featureFlags.removeFeatureFlagsHandler(handler)
                    reject(new Error('Timed out waiting for reloadFeatureFlags response'))
                }, 10000)
                state.instance.featureFlags.addFeatureFlagsHandler(handler)
                state.instance.reloadFeatureFlags()
            })
        }

        const value = state.instance.getFeatureFlag(key)

        res.json({ success: true, value })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.post('/reset', (req, res) => {
    discardInstance()
    global.localStorage.clear()

    state.capturedEvents = []
    state.pendingEvents = []
    state.totalEventsSent = 0
    state.requestsMade = []

    res.json({ success: true })
})

const port = process.env.PORT || 8080
app.listen(port, () => {
    console.log(`PostHog Browser SDK adapter listening on port ${port}`)
})
