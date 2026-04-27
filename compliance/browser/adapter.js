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
    totalEventsSent: 0,
    requestsMade: [],
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
const PostHogModule = require('../../packages/browser/dist/module')

// Create a PostHog instance
const { PostHog } = PostHogModule
const posthog = new PostHog()

const app = express()
app.use(express.json())

app.get('/health', (req, res) => {
    res.json({
        sdk_name: 'posthog-js',
        sdk_version: require('../../packages/browser/package.json').version,
        adapter_version: '1.0.0',
        capabilities: ['capture_v0', 'encoding_gzip'],
    })
})

app.post('/init', (req, res) => {
    const { api_key, host, flush_at, flush_interval_ms } = req.body

    // Reset state
    state.capturedEvents = []
    state.totalEventsSent = 0
    state.requestsMade = []

    // Reset the PostHog instance if it was previously initialized
    if (state.instance && state.instance.__loaded) {
        posthog.reset()
        // Clear localStorage to fully reset state
        global.localStorage.clear()
        // Manually reset __loaded flag to allow re-initialization
        posthog.__loaded = false
    }

    // Initialize PostHog (use the singleton instance)
    posthog.init(api_key, {
        api_host: host,
        persistence: 'memory',
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true,
        advanced_disable_feature_flags: false,
        advanced_disable_feature_flags_on_first_load: true,
        // Test-friendly settings - use request_queue_config for batching
        request_queue_config: {
            flush_interval_ms: flush_interval_ms ?? 100,
            flush_at: flush_at ?? 1,
        },
        // Track events before sending
        before_send: (event) => {
            state.capturedEvents.push(event)
            return event
        },
    })

    state.instance = posthog

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
        // Identify the user if distinct_id provided
        if (distinct_id) {
            state.instance.identify(distinct_id)
        }

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
    // Browser SDK doesn't have explicit flush - it uses internal timers
    // Need generous wait for Docker network latency
    await new Promise(resolve => setTimeout(resolve, 2000))

    res.json({ success: true, events_flushed: state.totalEventsSent })
})

app.get('/state', (req, res) => {
    const pendingEvents = state.capturedEvents.length - state.totalEventsSent

    res.json({
        pending_events: Math.max(0, pendingEvents),
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
    if (state.instance) {
        state.instance.reset()
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
