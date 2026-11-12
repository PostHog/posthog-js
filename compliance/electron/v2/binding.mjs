// Only public APIs present in the installed Electron 0.1.0-alpha.0 package.
export const routes = [
    '/setup',
    '/capture',
    '/identify',
    '/capture_exception',
    '/flush',
    '/reset',
    '/get_feature_flag',
    '/get_feature_flag_payload',
    '/reload_feature_flags',
]
export const failure = (kind, code, message) => ({ kind: 'harness', failure: { kind, code, message } })
class Gap extends Error {
    constructor(completion) {
        super(completion.failure.message)
        this.completion = completion
    }
}
const unsupported = (path) => {
    throw new Gap(failure('unsupported_binding', 'unsupported-parameter', `No binding for ${path}`))
}
const own = (value, key) => Object.hasOwn(value, key)
function keys(value, allowed, path) {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) unsupported(`${path}/${key}`)
}
const configFields = {
    host: 'host',
    flush_at: 'flushAt',
    flush_interval_ms: 'flushInterval',
    max_retries: 'fetchRetryCount',
    disable_geoip: 'disableGeoip',
    disabled: 'disabled',
    default_opt_in: 'defaultOptIn',
    preload_feature_flags: 'preloadFeatureFlags',
    disable_remote_feature_flags: 'disableRemoteFeatureFlags',
    bootstrap: 'bootstrap',
    person_profiles: 'personProfiles',
    feature_flags_request_max_retries: 'featureFlagsRequestMaxRetries',
}
export function setupOptions(args) {
    keys(args, ['project_token', 'config'], '/setup')
    const config = own(args, 'config') ? args.config : {}
    if (config === null || typeof config !== 'object' || Array.isArray(config)) unsupported('/setup/config')
    keys(config, [...Object.keys(configFields), 'compression'], '/setup/config')
    const options = { projectToken: args.project_token, captureAppLifecycleEvents: false }
    for (const [key, value] of Object.entries(config)) {
        if (key === 'compression') {
            if (!['none', 'gzip'].includes(value)) unsupported('/setup/config/compression')
            options.disableCompression = value === 'none'
        } else options[configFields[key]] = value
    }
    return options
}
function parameters(args, names) {
    const last = names.findLastIndex((name) => own(args, name))
    return names.slice(0, last + 1).map((name) => args[name])
}
function jsonData(value, ancestors = new Set()) {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return true
    if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
    if (typeof value !== 'object' || ancestors.has(value)) return false
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false
    ancestors.add(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const entries = Reflect.ownKeys(descriptors).filter((key) => !(Array.isArray(value) && key === 'length'))
    const valid =
        (!Array.isArray(value) || entries.length === value.length) &&
        entries.every(
            (key) =>
                typeof key === 'string' &&
                descriptors[key].enumerable &&
                own(descriptors[key], 'value') &&
                jsonData(descriptors[key].value, ancestors)
        )
    ancestors.delete(value)
    return valid
}
export class Binding {
    constructor(setup, profile) {
        this.setup = setup
        this.profile = profile
        this.exceptions = new Map()
    }
    async invoke(route, args) {
        try {
            if (!routes.includes(route))
                return failure('unsupported_binding', 'unsupported-route', `No binding for ${route}`)
            if (route === '/setup') {
                if (this.client) return failure('unsupported_binding', 'repeated-setup', 'SDK already initialized')
                this.client = await this.setup(setupOptions(args))
                return { kind: 'sdk', outcome: { kind: 'void' } }
            }
            if (!this.client) return failure('unsupported_binding', 'before-setup', 'Public initialization required')
            let result
            let nativeVoid = true
            if (route === '/capture') {
                keys(args, ['event', 'properties'], route)
                result = await this.client.capture(...parameters(args, ['event', 'properties']))
            } else if (route === '/identify') {
                keys(args, ['distinct_id', 'set'], route)
                result = await this.client.identify(...parameters(args, ['distinct_id', 'set']))
            } else if (route === '/capture_exception') {
                keys(args, ['error', 'properties'], route)
                if (!args.error || args.error.type !== 'TypeError' || typeof args.error.message !== 'string')
                    return failure(
                        'blocked_fixture',
                        'exception-fixture',
                        'Native fixture requires TypeError and string message'
                    )
                keys(args.error, ['type', 'message'], `${route}/error`)
                const params = [new TypeError(args.error.message)]
                if (own(args, 'properties')) params.push(args.properties)
                result = await this.client.captureException(...params)
            } else if (route === '/flush' || route === '/reset' || route === '/reload_feature_flags') {
                keys(args, [], route)
                const method =
                    route === '/flush'
                        ? 'flush'
                        : route === '/reset'
                          ? 'reset'
                          : this.profile === 'electron-main'
                            ? 'reloadFeatureFlagsAsync'
                            : 'reloadFeatureFlags'
                result = await this.client[method]()
            } else {
                keys(args, ['key'], route)
                nativeVoid = false
                result = await this.client[route === '/get_feature_flag' ? 'getFeatureFlag' : 'getFeatureFlagPayload'](
                    ...parameters(args, ['key'])
                )
            }
            if (result === undefined) return { kind: 'sdk', outcome: { kind: nativeVoid ? 'void' : 'undefined' } }
            if (!jsonData(result))
                return failure(
                    'blocked_fixture',
                    'native-non-json-result',
                    'Native result has no lossless JSON representation'
                )
            return { kind: 'sdk', outcome: { kind: 'value', value: result } }
        } catch (error) {
            if (error instanceof Gap) return error.completion
            if (!(error instanceof Error))
                return failure('blocked_fixture', 'native-non-json-result', 'Native throw is not an exception object')
            if (!this.exceptions.has(error)) this.exceptions.set(error, globalThis.crypto.randomUUID())
            return {
                kind: 'sdk',
                outcome: { kind: 'thrown', error: { kind: 'exception', id: this.exceptions.get(error) } },
            }
        }
    }
}
