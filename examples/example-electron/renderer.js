import { init } from '@posthog/electron/renderer'

async function start() {
    const posthog = await init()
    const status = document.querySelector('#status')
    const state = document.querySelector('#state')
    const flagKey = 'electron-example'

    function renderState() {
        state.textContent = JSON.stringify(
            {
                distinctId: posthog.getDistinctId(),
                sessionId: posthog.getSessionId(),
                optedOut: posthog.hasOptedOutCapturing(),
                flag: posthog.getFeatureFlag(flagKey, { sendEvent: false }),
                payload: posthog.getFeatureFlagPayload(flagKey),
            },
            null,
            2
        )
    }

    function action(id, run) {
        document.querySelector(`#${id}`).addEventListener('click', async () => {
            try {
                await run()
                renderState()
                status.textContent = `${id}: completed`
            } catch (error) {
                status.textContent = `${id}: ${error.message}`
            }
        })
    }

    action('capture', () => posthog.capture('electron_renderer_button', { source: 'button' }))
    action('identify', () => posthog.identify(document.querySelector('#user-id').value, { sample: 'electron' }))
    action('reset', () => posthog.reset())
    action('group', () => posthog.group('organization', document.querySelector('#group-key').value, { sample: true }))
    action('register', () => posthog.register({ example_property: 'registered in renderer' }))
    action('unregister', () => posthog.unregister('example_property'))
    action('opt-out', () => posthog.optOut())
    action('opt-in', () => posthog.optIn())
    action('flags', async () => {
        await posthog.reloadFeatureFlags()
        const value = posthog.getFeatureFlag(flagKey)
        await posthog.capture('electron_flag_evaluated', {
            flag: value,
            enabled: posthog.isFeatureEnabled(flagKey),
        })
    })
    action('exception', async () => {
        try {
            throw new Error('Handled Electron example exception')
        } catch (error) {
            await posthog.captureException(error, { source: 'renderer-button' })
        }
    })
    action('flush', () => posthog.flush())

    const unsubscribe = posthog.onStateChange(renderState)
    window.addEventListener(
        'unload',
        () => {
            unsubscribe()
            posthog.dispose()
        },
        { once: true }
    )
    renderState()
    document.querySelector('#controls').disabled = false
    status.textContent = 'Ready. State changes are shared across registered windows.'

    // The smoke driver exercises this real facade, not a replacement bridge or a mocked renderer.
    window.examplePostHog = posthog
}

start().catch((error) => {
    document.querySelector('#status').textContent = `Initialization failed: ${error.message}`
    console.error(error)
})
