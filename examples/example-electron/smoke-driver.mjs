import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { flagKey, flagPayload } from './mock-server.mjs'

async function evaluate(window, fn, ...args) {
    return window.webContents.executeJavaScript(`(${fn.toString()})(window.examplePostHog, ...${JSON.stringify(args)})`)
}

async function waitFor(label, check) {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
        if (await check()) return
        await delay(25)
    }
    throw new Error(`Timed out waiting for ${label}`)
}

export async function runSmokeDriver([first, second], main) {
    for (const window of [first, second]) {
        await waitFor('renderer SDK initialization', () => evaluate(window, (posthog) => Boolean(posthog)))
        assert.equal(await evaluate(window, () => typeof require), 'undefined', 'renderer must not have Node access')
        const preferences = window.webContents.getLastWebPreferences()
        assert.equal(preferences.sandbox, true)
        assert.equal(preferences.contextIsolation, true)
        assert.equal(preferences.nodeIntegration, false)
        assert.deepEqual(
            await evaluate(window, (posthog) => ({ id: posthog.getDistinctId(), session: posthog.getSessionId() })),
            { id: main.getDistinctId(), session: main.getSessionId() }
        )
    }
    const anonymousId = main.getDistinctId()
    assert.ok(anonymousId)
    assert.ok(main.getSessionId())
    await evaluate(second, (posthog) => {
        window.smokeStateChanges = 0
        window.smokeUnsubscribe = posthog.onStateChange(() => window.smokeStateChanges++)
    })
    await evaluate(first, (posthog) => posthog.capture('smoke_anonymous'))
    await evaluate(first, (posthog) => posthog.identify('electron-smoke-user', { sample_name: 'Smoke User' }))
    await waitFor('shared identify', async () => {
        return (await evaluate(second, (posthog) => posthog.getDistinctId())) === 'electron-smoke-user'
    })
    assert.equal(main.getDistinctId(), 'electron-smoke-user')
    assert.ok(await evaluate(second, () => window.smokeStateChanges > 0))
    await evaluate(first, (posthog) => posthog.capture('smoke_identified_first'))
    await evaluate(second, (posthog) => posthog.capture('smoke_identified_second'))

    await evaluate(first, (posthog) => posthog.group('organization', 'smoke-org', { plan: 'test' }))
    await evaluate(first, (posthog) => posthog.register({ smoke_registered: 'shared' }))
    await evaluate(second, (posthog) => posthog.capture('smoke_grouped_second'))
    await evaluate(second, (posthog) => posthog.unregister('smoke_registered'))
    await evaluate(first, (posthog) => posthog.capture('smoke_unregistered_first'))

    await evaluate(first, (posthog) => posthog.flush())
    await evaluate(first, (posthog) => posthog.optOut())
    await waitFor('shared opt-out', () => evaluate(second, (posthog) => posthog.hasOptedOutCapturing()))
    assert.equal(main.optedOut, true)
    await evaluate(first, (posthog) => posthog.capture('smoke_forbidden_first'))
    await evaluate(second, (posthog) => posthog.capture('smoke_forbidden_second'))
    main.capture('smoke_forbidden_main')
    await main.flush()
    await evaluate(second, (posthog) => posthog.optIn())
    await waitFor('shared opt-in', async () => {
        return !(await evaluate(first, (posthog) => posthog.hasOptedOutCapturing()))
    })
    assert.equal(main.optedOut, false)
    await evaluate(first, (posthog) => posthog.capture('smoke_opted_in'))

    await evaluate(first, (posthog) => posthog.reloadFeatureFlags())
    for (const window of [first, second]) {
        await waitFor('shared feature flags', async () => {
            return (
                (await evaluate(
                    window,
                    (posthog, key) => posthog.getFeatureFlag(key, { sendEvent: false }),
                    flagKey
                )) === 'local-variant'
            )
        })
        assert.deepEqual(
            await evaluate(window, (posthog, key) => posthog.getFeatureFlagPayload(key), flagKey),
            flagPayload
        )
    }
    assert.equal(await evaluate(second, (posthog, key) => posthog.getFeatureFlag(key), flagKey), 'local-variant')
    assert.equal(await evaluate(second, (posthog, key) => posthog.isFeatureEnabled(key), flagKey), true)
    await evaluate(second, async (posthog) => {
        try {
            throw new Error('Electron smoke handled exception')
        } catch (error) {
            await posthog.captureException(error, { smoke_exception: true })
        }
        await posthog.flush()
    })

    await evaluate(first, (posthog) => posthog.register({ smoke_reset_property: 'cleared by reset' }))
    await evaluate(second, (posthog) => posthog.reset())
    await waitFor('shared reset', async () => {
        const id = await evaluate(first, (posthog) => posthog.getDistinctId())
        return id === main.getDistinctId() && id !== 'electron-smoke-user' && id !== anonymousId
    })
    assert.deepEqual(
        await evaluate(first, (posthog) => ({ id: posthog.getDistinctId(), session: posthog.getSessionId() })),
        await evaluate(second, (posthog) => ({ id: posthog.getDistinctId(), session: posthog.getSessionId() }))
    )
    await evaluate(first, (posthog) => posthog.capture('smoke_reset_first'))
    await evaluate(second, (posthog) => posthog.capture('smoke_reset_second'))
    await evaluate(second, (posthog) => posthog.flush())
    await evaluate(second, () => window.smokeUnsubscribe())
    console.log('Electron renderer assertions passed in two sandboxed windows.')
}
