/**
 * PostHog Node SDK Compliance Adapter
 *
 * Wraps the posthog-node SDK for the YAML compliance harness (capture v1).
 */

import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'
import express from 'express'
import { PostHog } from '../packages/node/dist/entrypoints/index.node.mjs'

const SDK_VERSION = JSON.parse(readFileSync(new URL('../packages/node/package.json', import.meta.url), 'utf8')).version

const app = express()
app.use(express.json())

// The harness has one enable_compression flag but a test per codec, so each
// adapter process runs one codec and advertises only that encoding capability.
const COMPRESSION = process.env.COMPRESSION || 'gzip'
const CODECS = ['gzip', 'deflate', 'zstd']
if (!CODECS.includes(COMPRESSION)) {
    throw new Error(`unsupported COMPRESSION ${JSON.stringify(COMPRESSION)}: want one of ${CODECS.join(', ')}`)
}

const DECOMPRESS = {
    gzip: zlib.gunzipSync,
    deflate: zlib.inflateSync,
    zstd: zlib.zstdDecompressSync,
}

const state = {
    client: null,
    // With a personal_api_key, a second client without definitions answers force_remote lookups.
    remoteClient: null,
    // Status codes of /flags/definitions responses, in order.
    definitionsLoads: [],
    reloading: false,
    totalEventsCaptured: 0,
    totalEventsSent: 0,
    lastError: null,
    requestsMade: [],
    pendingEvents: 0,
    reportedDrops: [],
    logLines: [],
    // Event names per uuid in send order (from requests) and in call order (from captureAi), so a reported drop can
    // name its event; a duplicate uuid has several names. Kept apart so one event is never counted twice.
    sentNames: new Map(),
    calledNames: new Map(),
}

function resetCounters() {
    state.totalEventsCaptured = 0
    state.totalEventsSent = 0
    state.lastError = null
    state.requestsMade = []
    state.pendingEvents = 0
    state.reportedDrops = []
    state.logLines = []
    state.sentNames = new Map()
    state.calledNames = new Map()
}

// The SDK logs through console; /state returns those lines (log_capture).
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const write = console[level].bind(console)
    console[level] = (...args) => {
        state.logLines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
        write(...args)
    }
}

function rememberName(names, uuid, event) {
    if (uuid) {
        names.set(uuid, [...(names.get(uuid) ?? []), event])
    }
}

function recordDrops(error) {
    const duplicatesSeen = new Map()
    for (const { uuid, details } of error?.drops ?? []) {
        const names = state.sentNames.get(uuid) ?? state.calledNames.get(uuid) ?? []
        let index = 0
        if (details === 'duplicate_event_uuid') {
            // Capture keeps the first copy, so the dropped copies are the later names, in order.
            index = 1 + (duplicatesSeen.get(uuid) ?? 0)
            duplicatesSeen.set(uuid, index)
        }
        state.reportedDrops.push({ uuid, event: names[index] ?? names[0] ?? null, details: details ?? null })
    }
}

const PADDING_KEY = '$test_padding'

// One ASCII padding property makes the properties' compact JSON exactly `size` bytes (generated_payloads).
function padProperties(properties, size, marker = '') {
    const padded = { ...properties, [PADDING_KEY]: '' }
    const fill = size - Buffer.byteLength(JSON.stringify(padded), 'utf8')
    // The marker's bytes as written in JSON, escapes included, without its quotes.
    const markerBytes = Buffer.byteLength(JSON.stringify(marker), 'utf8') - 2
    if (fill < markerBytes) {
        throw new Error(`pad_properties_to_bytes ${size} is smaller than the properties`)
    }
    padded[PADDING_KEY] = marker + 'x'.repeat(fill - markerBytes)
    return padded
}

async function discardClient() {
    const clients = [state.client, state.remoteClient].filter(Boolean)
    state.client = null
    state.remoteClient = null

    // Test resets should not flush queued events into the next mock-server scenario.
    for (const client of clients) {
        try {
            await client.shutdown(1)
        } catch {
            // The next test starts with a fresh client.
        }
    }
}

function headerValue(headers, name) {
    if (!headers) {
        return undefined
    }
    if (typeof headers.get === 'function') {
        return headers.get(name) ?? undefined
    }
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
    return key === undefined ? undefined : headers[key]
}

// Best effort: /state is diagnostic, so an unreadable body only skips the counters.
function parseEvents(fetchOptions) {
    const body = fetchOptions?.body
    if (!body) {
        return []
    }
    let raw =
        typeof body === 'string'
            ? Buffer.from(body)
            : Buffer.from(body.buffer ?? body, body.byteOffset, body.byteLength)
    const encoding = headerValue(fetchOptions.headers, 'content-encoding')
    if (encoding && DECOMPRESS[encoding]) {
        raw = DECOMPRESS[encoding](raw)
    }
    const parsed = JSON.parse(raw.toString('utf8'))
    return Array.isArray(parsed?.batch) ? parsed.batch : []
}

function captureMessage({ distinct_id, event, properties, timestamp, options, uuid, pad_properties_to_bytes, marker }) {
    return {
        distinctId: distinct_id,
        event,
        properties:
            pad_properties_to_bytes === undefined
                ? properties || {}
                : padProperties(properties || {}, pad_properties_to_bytes, marker),
        timestamp: timestamp ? new Date(timestamp) : undefined,
        // Options and caller uuids go to the SDK unchanged; the SDK owns validation.
        options,
        uuid,
    }
}

app.get('/health', (req, res) => {
    res.json({
        sdk_name: 'posthog-node',
        sdk_version: SDK_VERSION,
        adapter_version: '2.0.0',
        capabilities: [
            'capture_v1',
            'capture_ai_v1',
            'event_options',
            'event_uuid_override',
            'bounded_retries',
            'disable_geoip',
            'historical_migration',
            'reported_drops',
            'log_capture',
            'generated_payloads',
            'property_layers',
            'fail_open',
            `encoding_${COMPRESSION}`,
            // Remote /flags requests send ?v=4 and read the v4 flag record.
            'flags_response_v4',
            'feature_flags_local_evaluation_v1',
            'feature_flag_payloads',
        ],
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
        super_properties,
        before_send,
        personal_api_key,
    } = req.body

    await discardClient()
    resetCounters()

    // The SDK compresses both lanes by default; the harness flag picks this process's codec or none.
    const compression = enable_compression === undefined ? undefined : enable_compression ? COMPRESSION : 'none'

    const options = {
        host,
        // flush_at: 1 sends on capture; default to 2 so a lone capture waits for /flush.
        flushAt: flush_at ?? 2,
        flushInterval: flush_interval_ms ?? 100,
        captureMaxRetries: max_retries ?? 3,
        captureCompression: compression,
        captureAiCompression: compression,
        disableGeoip: disable_geoip ?? false,
        historicalMigration: historical_migration ?? undefined,
        ...(before_send
            ? {
                  beforeSend: (event) => ({
                      ...event,
                      properties: { ...event.properties, ...before_send.set_properties },
                  }),
              }
            : {}),
        fetch: async (url, fetchOptions) => {
            const response = await fetch(url, fetchOptions)
            if (String(url).includes('/flags/definitions')) {
                state.definitionsLoads.push(response.status)
            }
            try {
                const events = parseEvents(fetchOptions)
                const attempt = Number(headerValue(fetchOptions?.headers, 'posthog-attempt') ?? 1)
                if (attempt === 1) {
                    for (const event of events) {
                        rememberName(state.sentNames, event.uuid, event.event)
                    }
                }
                state.requestsMade.push({
                    timestamp_ms: Date.now(),
                    status_code: response.status,
                    retry_attempt: Math.max(0, attempt - 1),
                    event_count: events.length,
                    uuid_list: events.map((e) => e.uuid).filter(Boolean),
                })
                if (response.status === 200) {
                    state.totalEventsSent += events.length
                    state.pendingEvents = Math.max(0, state.pendingEvents - events.length)
                }
            } catch {
                // Diagnostic counters only.
            }
            return response
        },
    }
    // Local evaluation tests reload definitions on demand, so automatic polling is off.
    state.client = new PostHog(
        api_key,
        personal_api_key ? { ...options, secretKey: personal_api_key, featureFlagsPollingInterval: null } : options
    )
    state.remoteClient = personal_api_key ? new PostHog(api_key, options) : null
    for (const client of [state.client, state.remoteClient].filter(Boolean)) {
        client.on('error', (error) => {
            state.lastError = error?.message ?? String(error)
            recordDrops(error)
        })
        if (super_properties) {
            await client.register(super_properties)
        }
    }

    res.json({ success: true })
})

app.post('/capture', (req, res) => {
    if (!state.client) {
        return res.status(400).json({ error: 'SDK not initialized' })
    }

    try {
        const message = captureMessage(req.body)
        state.client.capture(message)
        state.totalEventsCaptured++
        state.pendingEvents++
        // capture() returns nothing, so only a caller-supplied uuid is known here.
        res.json({ success: true, uuid: message.uuid ?? null })
    } catch (error) {
        state.lastError = error.message
        res.status(500).json({ error: error.message })
    }
})

app.post('/capture_ai', (req, res) => {
    if (!state.client) {
        return res.status(400).json({ error: 'SDK not initialized' })
    }

    try {
        const uuid = state.client.captureAi(captureMessage(req.body))
        // A local drop is never sent, so it is named from the call.
        rememberName(state.calledNames, uuid, req.body.event)
        state.totalEventsCaptured++
        state.pendingEvents++
        res.json({ success: true, uuid: uuid ?? null })
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
        res.json({ success: true, events_flushed: state.totalEventsSent - sentBeforeFlush })
    } catch (error) {
        // Retry tests configure failing responses on purpose; the harness inspects the requests instead.
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
        total_retries: state.requestsMade.filter((r) => r.retry_attempt > 0).length,
        last_error: state.lastError,
        requests_made: state.requestsMade,
        reported_drops: state.reportedDrops,
        log_lines: state.logLines,
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
        only_evaluate_locally = false,
    } = req.body || {}
    const force_remote = req.body?.force_remote ?? !only_evaluate_locally

    if (only_evaluate_locally && force_remote) {
        return res.status(400).json({ error: 'only_evaluate_locally conflicts with force_remote' })
    }

    if (!key) {
        return res.status(400).json({ error: 'key is required' })
    }
    if (!distinct_id) {
        return res.status(400).json({ error: 'distinct_id is required' })
    }

    try {
        if (only_evaluate_locally) {
            const value = await state.client.getFeatureFlag(key, distinct_id, {
                groups,
                personProperties: person_properties,
                groupProperties: group_properties,
                disableGeoip: disable_geoip,
                onlyEvaluateLocally: true,
                sendFeatureFlagEvents: false,
            })
            // The local-only API returns undefined when local evaluation is inconclusive; a conclusive false is false.
            const conclusive = value !== undefined
            return res.json({ success: conclusive, value: conclusive ? value : null, locally_evaluated: conclusive })
        }

        const client = force_remote ? (state.remoteClient ?? state.client) : state.client
        const value = await client.getFeatureFlag(key, distinct_id, {
            groups,
            personProperties: person_properties,
            groupProperties: group_properties,
            disableGeoip: disable_geoip,
            onlyEvaluateLocally: !force_remote,
        })

        // Flush the $feature_flag_called event so it cannot leak into the next test case.
        await client.flush()

        res.json({ success: true, value })
    } catch (error) {
        state.lastError = error.message
        res.status(500).json({ error: error.message })
    }
})

app.post('/get_feature_flag_payload', async (req, res) => {
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
        only_evaluate_locally = false,
    } = req.body || {}
    const force_remote = req.body?.force_remote ?? !only_evaluate_locally
    if (only_evaluate_locally && force_remote) {
        return res.status(400).json({ error: 'only_evaluate_locally conflicts with force_remote' })
    }
    if (!key || !distinct_id) {
        return res.status(400).json({ error: 'key and distinct_id are required' })
    }

    try {
        const client = force_remote ? (state.remoteClient ?? state.client) : state.client
        const payload = await client.getFeatureFlagPayload(key, distinct_id, undefined, {
            groups,
            personProperties: person_properties,
            groupProperties: group_properties,
            disableGeoip: disable_geoip,
            onlyEvaluateLocally: !force_remote,
        })
        await client.flush()
        res.json({ success: true, value: payload ?? null })
    } catch (error) {
        state.lastError = error.message
        res.status(500).json({ error: error.message })
    }
})

app.post('/reload_feature_flag_definitions', async (req, res) => {
    const timeoutMs = req.body?.timeout_ms ?? 5000
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
        return res.status(400).json({ success: false, ready: false, error: 'Invalid timeout_ms' })
    }
    const client = state.client
    if (!client || !state.remoteClient) {
        return res.status(400).json({ success: false, ready: false, error: 'A personal_api_key is required' })
    }
    if (state.reloading) {
        return res.status(409).json({ success: false, ready: false, error: 'A definitions reload is still running' })
    }

    state.reloading = true
    // reloadFeatureFlags joins a load already in flight, so wait that out before forcing a fresh GET.
    const reload = (async () => {
        await client.reloadFeatureFlags()
        const before = state.definitionsLoads.length
        await client.reloadFeatureFlags()
        return state.definitionsLoads.slice(before)
    })()
    let timer
    const timeout = new Promise((resolve) => {
        // The check above already rejects other values; the clamp states the bound where the timer is set.
        timer = setTimeout(() => resolve(null), Math.min(Math.max(timeoutMs, 1), 30000))
    })
    try {
        const loads = await Promise.race([reload, timeout])
        if (loads === null) {
            return res.status(504).json({ success: false, ready: false, error: 'Definitions reload timed out' })
        }
        if (state.client !== client) {
            return res.status(409).json({ success: false, ready: false, error: 'SDK reset during reload' })
        }
        // The SDK swallows load failures, so readiness needs a successful fresh response.
        if (!loads.some((status) => status === 200 || status === 304)) {
            return res.status(502).json({ success: false, ready: false, error: 'Fresh definitions were not loaded' })
        }
        res.json({ success: true, ready: true })
    } finally {
        clearTimeout(timer)
        reload.finally(() => {
            state.reloading = false
        })
    }
})

app.post('/reset', async (req, res) => {
    await discardClient()
    resetCounters()
    res.json({ success: true })
})

const port = process.env.PORT || 8080
app.listen(port, () => {
    process.stdout.write(`PostHog Node SDK adapter listening on port ${port} (compression=${COMPRESSION})\n`)
})
