import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForSessionRecordingToStart } from '../utils/setup'

const configKey = '$session_recording_remote_config'
const startOptions = {
    url: '/playground/cypress/index.html',
    options: {
        persistence: 'localStorage' as const,
        strict_script_versioning: false as const,
        session_recording: { compress_events: false },
    },
    flagsResponseOverrides: {
        sessionRecording: { endpoint: '/ses/' },
        autocapture_opt_out: true,
    },
}

test.beforeEach(async ({ page }) => {
    await page.route(/\/array\/[^/]+\/config\.js(\?|$)/, (route) =>
        route.fulfill({ contentType: 'application/javascript', body: '' })
    )
})

test('refreshes stale recording config after capturing an event while stopped', async ({ page, context }) => {
    await start(startOptions, page, context)
    await waitForSessionRecordingToStart(page)

    const persisted = await page.evaluate((key) => {
        const ph = (window as WindowWithPostHog).posthog!
        ph.stopSessionRecording()
        const staleConfig = { ...ph.get_property(key), cache_timestamp: Date.now() - 60 * 60 * 1000 - 1 }
        ph.persistence!.register({ [key]: staleConfig })
        ph.capture('event while recording is stopped')
        return { expected: staleConfig, actual: ph.get_property(key), started: ph.sessionRecordingStarted() }
    }, configKey)
    expect(persisted.actual).toEqual(persisted.expected)
    expect(persisted.started).toBe(false)

    let releaseConfig!: () => void
    const configGate = new Promise<void>((resolve) => {
        releaseConfig = resolve
    })
    let refreshRequests = 0
    await page.route(/\/array\/[^/]+\/config(\?|$)/, async (route) => {
        refreshRequests++
        await configGate
        await route.fulfill({ json: startOptions.flagsResponseOverrides })
    })

    try {
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog!
            ph.startSessionRecording()
            ph.capture('event while recording config is refreshing')
            ph.startSessionRecording()
        })
        await expect.poll(() => refreshRequests).toBe(1)
        expect(await page.evaluate(() => (window as WindowWithPostHog).posthog!.sessionRecordingStarted())).toBe(false)
        expect(
            await page.evaluate((key) => (window as WindowWithPostHog).posthog!.get_property(key), configKey)
        ).toEqual(persisted.expected)
    } finally {
        releaseConfig()
    }

    await waitForSessionRecordingToStart(page)
    expect(
        await page.evaluate(
            (key) => (window as WindowWithPostHog).posthog!.get_property(key).cache_timestamp,
            configKey
        )
    ).toBeGreaterThan(persisted.expected.cache_timestamp)
})

test('preserves legacy persisted recording config during a delayed cold-start config response', async ({
    page,
    context,
}) => {
    await start(startOptions, page, context)
    await waitForSessionRecordingToStart(page)
    const legacyConfig = await page.evaluate((key) => {
        const ph = (window as WindowWithPostHog).posthog!
        ph.stopSessionRecording()
        const config = { ...ph.get_property(key) }
        delete config.cache_timestamp
        ph.persistence!.register({ [key]: config })
        return config
    }, configKey)

    let releaseConfig!: () => void
    const configGate = new Promise<void>((resolve) => {
        releaseConfig = resolve
    })
    await page.route(/\/array\/[^/]+\/config(\?|$)/, async (route) => {
        await configGate
        await route.fulfill({ json: startOptions.flagsResponseOverrides })
    })

    try {
        const recorderResponse = page.waitForResponse(/\/static\/(lazy-)?recorder\.js/)
        await start({ ...startOptions, type: 'reload', waitForFlags: false }, page, context)
        await recorderResponse
        await page.waitForFunction(
            () => (window as WindowWithPostHog).posthog?.sessionRecording?.status !== 'lazy_loading'
        )
        const persisted = await page.evaluate((key) => {
            const ph = (window as WindowWithPostHog).posthog!
            ph.capture('event before cold-start config arrives')
            return ph.get_property(key)
        }, configKey)
        expect(persisted).toEqual(legacyConfig)
    } finally {
        releaseConfig()
    }

    await waitForSessionRecordingToStart(page)
})
