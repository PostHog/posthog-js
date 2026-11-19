import { init } from '@posthog/electron/renderer'

window.fixtureReady = (async () => {
    const hostEvents = []
    const dispatches = []
    const onerror = (message) => {
        hostEvents.push({ kind: 'onerror', message })
        return false
    }
    window.onerror = onerror
    window.addEventListener('unhandledrejection', (event) => {
        hostEvents.push({ kind: 'rejection', message: event.reason.message })
    })
    const enabled = new URLSearchParams(location.search).get('enabled') === 'true'
    const options = { enableExceptionAutocapture: enabled }
    let posthog = await init(options)
    // Listeners installed after the SDK see whether it cancelled the native dispatch.
    for (const type of ['error', 'unhandledrejection']) {
        window.addEventListener(type, (event) =>
            dispatches.push({ type, prevented: event.defaultPrevented, trusted: event.isTrusted })
        )
    }
    window.errorFixture = {
        get posthog() {
            return posthog
        },
        hostEvents,
        dispatches,
        ownsOnerror: () => window.onerror === onerror,
        trigger(label) {
            setTimeout(function rendererThrow() {
                throw new TypeError(`renderer ${label} throw`)
            }, 0)
            setTimeout(function rendererRejection() {
                void Promise.reject(new RangeError(`renderer ${label} rejection`))
            }, 0)
        },
        async reinitialize() {
            posthog = await init(options)
        },
    }
    await posthog.captureException(new SyntaxError('renderer manual'))
})()
