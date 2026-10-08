// Native signatures are pinned to posthog-node 5.52.4 (see README.md).
import { randomUUID } from 'node:crypto'

export const routes = [
    '/setup',
    '/capture',
    '/capture_ai',
    '/identify',
    '/alias',
    '/flush',
    '/get_feature_flag',
    '/reload_feature_flags',
]
export const failure = (kind, code, message) => ({ kind: 'harness', failure: { kind, code, message } })
class BindingGap extends Error {
    constructor(kind, code, message) {
        super(message)
        this.completion = failure(kind, code, message)
    }
}
const blocked = (code, message) => {
    throw new BindingGap('blocked_fixture', code, message)
}
const unsupported = (path) => {
    throw new BindingGap('unsupported_binding', 'unsupported-parameter', `No binding for ${path}`)
}
const own = (object, key) => Object.hasOwn(object, key)
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const configFields = {
    host: 'host',
    flush_at: 'flushAt',
    flush_interval_ms: 'flushInterval',
    max_retries: 'fetchRetryCount',
    disable_geoip: 'disableGeoip',
    historical_migration: 'historicalMigration',
    secret_key: 'secretKey',
}
const captureFields = {
    event: 'event',
    distinct_id: 'distinctId',
    properties: 'properties',
    groups: 'groups',
    timestamp: 'timestamp',
    uuid: 'uuid',
    disable_geoip: 'disableGeoip',
    send_feature_flags: 'sendFeatureFlags',
}
const flagFields = {
    groups: 'groups',
    person_properties: 'personProperties',
    group_properties: 'groupProperties',
    only_evaluate_locally: 'onlyEvaluateLocally',
    send_event: 'sendFeatureFlagEvents',
    disable_geoip: 'disableGeoip',
}
const sendFlagFields = {
    only_evaluate_locally: 'onlyEvaluateLocally',
    person_properties: 'personProperties',
    group_properties: 'groupProperties',
    flag_keys: 'flagKeys',
}
function checkKeys(value, keys, path) {
    for (const key of Object.keys(value)) if (!keys.includes(key)) unsupported(`${path}/${key}`)
}
function rename(value, fields, path) {
    // Preserve negative scalar/null inputs; do not validate semantic argument schemas.
    if (!object(value)) return value
    checkKeys(value, Object.keys(fields), path)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [fields[key], item]))
}
function config(value) {
    if (!object(value)) return value
    checkKeys(value, [...Object.keys(configFields), 'compression'], '/setup/config')
    const mapped = rename(
        Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'compression')),
        configFields,
        '/setup/config'
    )
    if (own(value, 'compression')) {
        if (!['none', 'gzip'].includes(value.compression)) unsupported('/setup/config/compression')
        mapped.disableCompression = value.compression === 'none'
    }
    return mapped
}
const optionProperties = {
    cookieless_mode: '$cookieless_mode',
    disable_skew_correction: '$ignore_sent_at',
    process_person_profile: '$process_person_profile',
    product_tour_id: '$product_tour_id',
}
function capture(args, captureMode) {
    if (!own(args, 'options')) return rename(args, captureFields, '/capture')
    if (captureMode !== 'v1' || !object(args.options)) unsupported('/capture/options')
    checkKeys(args.options, Object.keys(optionProperties), '/capture/options')
    const mapped = rename(
        Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'options')),
        captureFields,
        '/capture'
    )
    if (Object.keys(args.options).length) {
        if (own(args, 'properties') && !object(args.properties)) {
            blocked(
                'capture-options-representation',
                'Native option properties cannot be combined with non-object properties'
            )
        }
        const properties = { ...mapped.properties }
        for (const [key, value] of Object.entries(args.options)) {
            const property = optionProperties[key]
            if (own(properties, property)) {
                blocked('capture-options-collision', 'Native property and capture option occupy the same SDK input')
            }
            properties[property] = value
        }
        mapped.properties = properties
    }
    return mapped
}
function timestamp(value) {
    if (typeof value !== 'string') return value
    // Date has millisecond precision. Check the local calendar too: Date.parse
    // otherwise silently normalizes dates such as February 30.
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
    if (!match || /[1-9]/.test((match[2] || '').slice(3)))
        blocked('timestamp-representation', 'Timestamp cannot be represented losslessly by Date')
    const local = `${match[1]}.${(match[2] || '').padEnd(3, '0').slice(0, 3)}Z`
    const localDate = new Date(local)
    const date = new Date(value)
    if (!Number.isFinite(+date) || !Number.isFinite(+localDate) || localDate.toISOString() !== local) {
        blocked('timestamp-representation', 'Timestamp cannot be represented losslessly by Date')
    }
    return date
}
function jsonData(value, ancestors = new Set()) {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return true
    if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
    if (typeof value !== 'object' || ancestors.has(value)) return false
    if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
    )
        return false
    ancestors.add(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors).filter((key) => !(Array.isArray(value) && key === 'length'))
    const valid =
        (!Array.isArray(value) || keys.length === value.length) &&
        keys.every(
            (key) =>
                typeof key === 'string' &&
                descriptors[key].enumerable &&
                own(descriptors[key], 'value') &&
                jsonData(descriptors[key].value, ancestors)
        )
    ancestors.delete(value)
    return valid
}
export function classify(value, nativeVoid = false) {
    if (value === undefined) return { kind: nativeVoid ? 'void' : 'undefined' }
    if (!jsonData(value))
        blocked('native-non-json-result', 'Native result has no selected lossless JSON representation')
    return { kind: 'value', value }
}
export class Binding {
    constructor(PostHog, captureMode = 'v0') {
        this.PostHog = PostHog
        this.captureMode = captureMode
        this.client = undefined
        this.exceptions = new Map()
    }
    async invoke(route, args) {
        try {
            let result
            if (!routes.includes(route))
                return failure('unsupported_binding', 'unsupported-route', `No binding for ${route}`)
            if (route === '/setup') {
                checkKeys(args, ['project_token', 'config'], route)
                if (this.client !== undefined)
                    return failure(
                        'unsupported_binding',
                        'repeated-setup',
                        'A bound constructor receiver cannot be initialized again'
                    )
                const parameters = own(args, 'config')
                    ? [args.project_token, config(args.config)]
                    : own(args, 'project_token')
                      ? [args.project_token]
                      : []
                this.client = new this.PostHog(...parameters)
                return { kind: 'sdk', outcome: { kind: 'void' } }
            }
            if (this.client === undefined)
                return failure('unsupported_binding', 'before-setup', 'This instance API requires public construction')
            if (route === '/capture' || route === '/capture_ai') {
                const mapped =
                    route === '/capture' ? capture(args, this.captureMode) : rename(args, captureFields, route)
                if (own(mapped, 'timestamp')) mapped.timestamp = timestamp(mapped.timestamp)
                if (own(mapped, 'sendFeatureFlags'))
                    mapped.sendFeatureFlags = rename(
                        mapped.sendFeatureFlags,
                        sendFlagFields,
                        `${route}/send_feature_flags`
                    )
                result = route === '/capture' ? this.client.capture(mapped) : this.client.captureAi(mapped)
            } else if (route === '/identify') {
                const mapped = rename(
                    args,
                    { distinct_id: 'distinctId', set: 'properties', disable_geoip: 'disableGeoip' },
                    route
                )
                // `set` contains literal user properties, including any reserved-looking keys.
                if (own(args, 'set')) mapped.properties = { $set: args.set }
                result = this.client.identify(mapped)
            } else if (route === '/alias') {
                result = this.client.alias(
                    rename(args, { distinct_id: 'distinctId', alias: 'alias', disable_geoip: 'disableGeoip' }, route)
                )
            } else if (route === '/flush') {
                checkKeys(args, [], route)
                result = await this.client.flush()
            } else if (route === '/reload_feature_flags') {
                checkKeys(args, [], route)
                result = await this.client.reloadFeatureFlags()
            } else {
                checkKeys(args, ['key', 'distinct_id', ...Object.keys(flagFields)], route)
                const options = rename(
                    Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'key' && key !== 'distinct_id')),
                    flagFields,
                    route
                )
                const parameters = Object.keys(options).length
                    ? [args.key, args.distinct_id, options]
                    : own(args, 'distinct_id')
                      ? [args.key, args.distinct_id]
                      : own(args, 'key')
                        ? [args.key]
                        : []
                result = await this.client.getFeatureFlag(...parameters)
            }
            return {
                kind: 'sdk',
                outcome: classify(
                    result,
                    route === '/capture' ||
                        route === '/identify' ||
                        route === '/alias' ||
                        route === '/flush' ||
                        route === '/reload_feature_flags'
                ),
            }
        } catch (error) {
            if (error instanceof BindingGap) return error.completion
            if (!(error instanceof Error))
                return failure('blocked_fixture', 'native-non-json-result', 'Native throw is not an exception object')
            let id = this.exceptions.get(error)
            if (!id) {
                id = randomUUID()
                this.exceptions.set(error, id)
            }
            return { kind: 'sdk', outcome: { kind: 'thrown', error: { kind: 'exception', id } } }
        }
    }
}
