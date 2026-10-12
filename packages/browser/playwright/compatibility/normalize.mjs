/* eslint-disable posthog-js/no-direct-number-check -- Standalone browser test fixtures exercise public APIs without importing SDK runtime helpers. */
import { gunzipSync } from 'node:zlib'

export function decodeReplay(value, path = '') {
    if (Array.isArray(value)) return value.map((item, index) => decodeReplay(item, `${path}[${index}]`))
    if (!value || typeof value !== 'object') return value
    const result = { ...value }
    if (result.cv && /\.\$snapshot_data\[\d+\]$/.test(path)) {
        if (result.cv !== '2024-10') throw new Error(`Unsupported replay compression: ${result.cv}`)
        const unzip = (v) =>
            typeof v === 'string' && v.startsWith('\x1f\x8b')
                ? JSON.parse(gunzipSync(Buffer.from(v, 'latin1')).toString('utf8'))
                : v
        result.data = unzip(result.data)
        if (result.data && typeof result.data === 'object')
            result.data = Object.fromEntries(Object.entries(result.data).map(([k, v]) => [k, unzip(v)]))
    }
    return Object.fromEntries(
        Object.entries(result).map(([key, item]) => [key, decodeReplay(item, path ? `${path}.${key}` : key)])
    )
}

const eventRoot =
    '(?:api\\.observations\\[\\d+\\]\\.returned|network\\.(?:events|snapshots)\\[\\d+\\]|network\\.requests\\[\\d+\\]\\.body(?:\\.batch)?(?:\\[\\d+\\])?)'
const eventEnvelope = new RegExp(`^${eventRoot}\\.(?:uuid|distinct_id)$`)
const eventProperty = new RegExp(`^${eventRoot}\\.properties\\.[^.]+$`)
const sdkProperties = new RegExp(`^${eventRoot}\\.properties$`)
const storageRoot = /^api\.storage\.(?:local|session)\.[^.]+$/
const storageProperty = /^api\.storage\.(?:local|session)\.[^.]+\.[^.]+(?:\[\d+\])?$/
const storedSessionId =
    /^api\.storage\.(?:local|session)\.[^.]+\.(?:\$client_session_props|\$sess_rec_flush_size)\.sessionId$/
const flagsRequestProperty = /^network\.requests\[\d+\]\.body\.(?:distinct_id|\$anon_distinct_id|\$device_id)$/
const callbackMetadata = /^api\.callbacks\[\d+\]\.values\[\d+\]\.requestId$/
const protocolQuery = /^network\.requests\[\d+\]\.query\.(?:ver|v)\[\d+\]$/
const otelAttribute =
    /\.resourceLogs\[\d+\]\.(?:resource\.attributes|scopeLogs\[\d+\]\.logRecords\[\d+\]\.attributes)\[\d+\]$/
const otelRecord = /\.resourceLogs\[\d+\]\.scopeLogs\[\d+\]\.logRecords\[\d+\]$/

export function normalize(snapshot, { origin, version, extensionVersion = version }) {
    const ids = new Map()
    const metadataVersion = (value, expected, role, path) => {
        if (value !== expected)
            throw new Error(`Unexpected ${role} metadata at ${path}: ${value}; expected ${expected}`)
        return `<${role}-version>`
    }
    const snapshotRequest = (path) => {
        const index = /^network\.requests\[(\d+)\]/.exec(path)?.[1]
        return index !== undefined && /^\/(s|newS)\/?$/.test(snapshot.network?.requests?.[index]?.path)
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const identityKeys = new Set([
        'distinct_id',
        '$anon_distinct_id',
        '$device_id',
        '$session_id',
        '$window_id',
        '$feature_flag_request_id',
        '$session_recording_session_id',
        '$session_recording_window_id',
        '$insert_id',
        '$survey_submission_id',
        '$pageview_id',
        '$prev_pageview_id',
    ])
    const fixtureHost = new URL(origin).host
    const mapId = (value) => {
        if (!ids.has(value)) ids.set(value, `generated-id-${ids.size + 1}`)
        return ids.get(value)
    }
    const visit = (value, key = '', path = '') => {
        if (typeof value === 'string') {
            const sdkId =
                eventEnvelope.test(path) ||
                (eventProperty.test(path) && identityKeys.has(key)) ||
                flagsRequestProperty.test(path) ||
                callbackMetadata.test(path) ||
                storedSessionId.test(path) ||
                /^api\.(get_distinct_id|get_session_id|identified-id|reset-id)$/.test(path) ||
                (storageProperty.test(path) && (identityKeys.has(key) || key === '$sesid')) ||
                (storageRoot.test(path) && key.endsWith('_window_id'))
            if (sdkId && (uuid.test(value) || key === '$insert_id')) return mapId(value)
            if (
                key === '$lib_version' &&
                (eventProperty.test(path) ||
                    storageProperty.test(path) ||
                    /\.person_properties\.\$lib_version$/.test(path))
            ) {
                const extension = /^network\.snapshots\[/.test(path) || snapshotRequest(path)
                return metadataVersion(
                    value,
                    extension ? extensionVersion : version,
                    extension ? 'extension' : 'core',
                    path
                )
            }
            if (
                protocolQuery.test(path) &&
                (/^\/static\//.test(
                    snapshot.network?.requests?.[/^network\.requests\[(\d+)\]/.exec(path)?.[1]]?.path
                ) ||
                    key === 'ver')
            )
                return metadataVersion(value, version, 'core', path)
            if (['$host', '$session_entry_host', '$initial_host'].includes(key) && value === fixtureHost)
                return '<fixture-host>'
            if (value.startsWith(origin)) {
                let relative = value
                    .slice(origin.length)
                    .replace(`/static/${version}/`, '/static/<core-version>/')
                    .replace(`?v=${version}`, '?v=<core-version>')
                if (key === 'sessionRecordingUrl' && eventProperty.test(path))
                    relative = relative.replace(
                        /\/replay\/([0-9a-f-]{36})(?=[/?#]|$)/i,
                        (_, id) => `/replay/${mapId(id)}`
                    )
                return '<fixture-origin>' + relative
            }
            if (storageRoot.test(path) && /^["{[]/.test(value)) {
                let parsed
                try {
                    parsed = JSON.parse(value)
                } catch {
                    return value
                }
                return visit(parsed, key, path)
            }
            return value
        }
        if (Array.isArray(value)) return value.map((item, index) => visit(item, key, `${path}[${index}]`))
        if (!value || typeof value !== 'object') return value
        const result = Object.create(null)
        for (const child of Object.keys(value).sort()) {
            let item = value[child]
            let childPath = path ? `${path}.${child}` : child
            if (
                child === 'returned' &&
                ['get_distinct_id', 'get_session_id', 'identified-id', 'reset-id'].includes(value.method)
            )
                childPath = `api.${value.method}`
            if (child === 'version' && /\.resourceLogs\[\d+\]\.scopeLogs\[\d+\]\.scope$/.test(path))
                item = metadataVersion(item, version, 'core', childPath)
            if (child === 'path' && /^network\.requests\[\d+\]$/.test(path) && typeof item === 'string')
                item = item.replace(`/static/${version}/`, '/static/<core-version>/')
            if (
                ['timeUnixNano', 'observedTimeUnixNano'].includes(child) &&
                otelRecord.test(path) &&
                typeof item === 'string' &&
                /^\d+$/.test(item)
            )
                item = '<clock>'
            const debugProperties = sdkProperties.test(path) || storageRoot.test(path)
            if (
                child === '$sdk_debug_extensions_init_time_ms' &&
                debugProperties &&
                typeof item === 'number' &&
                Number.isFinite(item)
            )
                item = '<cpu-duration-ms>'
            if (
                child === '$sdk_debug_replay_internal_buffer_length' &&
                debugProperties &&
                typeof item === 'number' &&
                Number.isFinite(item)
            )
                item = '<buffer-count>'
            if (
                ((['$sdk_debug_replay_internal_buffer_size', '$snapshot_bytes'].includes(child) && debugProperties) ||
                    (child === 'size' &&
                        /^api\.storage\.(?:local|session)\.[^.]+\.\$sess_rec_flush_size$/.test(path))) &&
                typeof item === 'number' &&
                Number.isFinite(item)
            )
                item = '<encoded-size>'
            if (child === 'value' && otelAttribute.test(path)) {
                if (['posthogDistinctId', 'sessionId', 'window.id'].includes(value.key) && uuid.test(item?.stringValue))
                    item = { ...item, stringValue: mapId(item.stringValue) }
                if (value.key === 'host' && item?.stringValue === fixtureHost)
                    item = { ...item, stringValue: '<fixture-host>' }
                if (['telemetry.sdk.version', 'posthog.lib.version'].includes(value.key))
                    item = { ...item, stringValue: metadataVersion(item?.stringValue, version, 'core', childPath) }
            }
            const normalizedKey =
                /^https?:/.test(child) &&
                child.startsWith(origin) &&
                new RegExp(`^${eventRoot}\\.properties\\.\\$heatmap_data$`).test(path)
                    ? '<fixture-origin>' + child.slice(origin.length)
                    : child
            result[normalizedKey] = visit(item, child, childPath)
        }
        return result
    }
    const decoded = decodeReplay(snapshot)
    if (decoded.network) {
        // Pending gate diagnostics are sampled control state, not delivered SDK payloads.
        delete decoded.network.blockedRequests
        // HTTP requests can complete independently; preserve array ordering inside each payload.
        const eventKey = (event) =>
            `${event.event}:${event.properties?.phase ?? ''}:${event.properties?.$event_type ?? ''}:${event.properties?.$elements_chain ?? JSON.stringify(event.properties?.$elements ?? '')}:${event.timestamp ?? ''}`
        decoded.network.events?.sort(
            (a, b) =>
                eventKey(a).localeCompare(eventKey(b)) ||
                (b.properties?.$lib_rate_limit_remaining_tokens ?? 0) -
                    (a.properties?.$lib_rate_limit_remaining_tokens ?? 0)
        )
        const logKey = (payload) =>
            JSON.stringify(
                payload.resourceLogs?.map((resource) => ({
                    service: resource.resource?.attributes?.find((attribute) => attribute.key === 'service.name')
                        ?.value,
                    bodies: resource.scopeLogs?.flatMap((scope) => scope.logRecords?.map((record) => record.body)),
                }))
            )
        decoded.network.logs?.sort((a, b) => logKey(a).localeCompare(logKey(b)))
    }
    const normalized = visit(decoded)
    if (normalized.network)
        normalized.network.requests?.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    return normalized
}

export function differences(expected, actual, path = '$', output = []) {
    if (Object.is(expected, actual)) return output
    if (
        expected === null ||
        actual === null ||
        typeof expected !== 'object' ||
        typeof actual !== 'object' ||
        Array.isArray(expected) !== Array.isArray(actual)
    ) {
        output.push({ path, expected, actual })
        return output
    }
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
        if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key))
            output.push({
                path: `${path}.${key}`,
                expected: expected[key],
                actual: actual[key],
                missing: !Object.hasOwn(actual, key) ? 'candidate' : 'baseline',
            })
        else differences(expected[key], actual[key], `${path}.${key}`, output)
    }
    return output
}
