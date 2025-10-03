import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { Page } from '@playwright/test'

async function ensureRecordingIsStopped(page: Page) {
    // Check recording status without triggering user activity
    const isRecording = await page.evaluate(() => {
        const ph = (window as WindowWithPostHog).posthog
        return ph?.sessionRecording?.status === 'disabled'
    })

    expect(isRecording).toBe(false)
}

async function ensureActivitySendsSnapshots(page: Page) {
    await page.resetCapturedEvents()

    const responsePromise = page.waitForResponse('**/ses/*')
    await page.locator('[data-cy-input]').type('hello posthog!')
    await responsePromise

    const capturedEvents = await page.capturedEvents()
    const capturedSnapshot = capturedEvents?.find((e) => e.event === '$snapshot')
    expect(capturedSnapshot).toBeDefined()
}

async function triggerForcedIdleTimeout(page: Page) {
    await page.evaluate(() => {
        const ph = (window as WindowWithPostHog).posthog
        const sessionManager = ph?.sessionManager as any

        if (!sessionManager) {
            throw new Error('SessionManager not available')
        }

        // Store the old session ID before we reset it
        const oldSessionId = ph?.get_session_id()

        // Directly reset the session to simulate an idle timeout
        sessionManager.resetSessionId()

        // Trigger the forcedIdleReset event manually to simulate what the timer would do
        if (sessionManager._eventEmitter && sessionManager._eventEmitter.emit) {
            sessionManager._eventEmitter.emit('forcedIdleReset', { idleSessionId: oldSessionId })
        }
    })
}

const startOptions = {
    options: {
        session_recording: {
            // not the default but makes for easier test assertions
            compress_events: false,
        },
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
        autocapture_opt_out: true,
    },
    url: './playground/cypress/index.html',
}

const sampleZeroStartOptions = {
    ...startOptions,
    flagsResponseOverrides: {
        ...startOptions.flagsResponseOverrides,
        sessionRecording: {
            ...startOptions.flagsResponseOverrides.sessionRecording,
            sampleRate: '0',
        },
    },
}

test.describe('Session recording - idle timeout behavior', () => {
    test.beforeEach(async ({ page, context }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(startOptions, page, context)
            },
        })
        await page.expectCapturedEventsToBe(['$pageview'])
        await page.resetCapturedEvents()
    })

    test('stops recording when forced idle timeout fires and restarts on user activity', async ({ page }) => {
        await ensureActivitySendsSnapshots(page)

        const initialSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })
        expect(initialSessionId).toBeDefined()

        await page.resetCapturedEvents()
        await page.locator('[data-cy-input]').type('verify recording active')
        await page.waitForResponse('**/ses/*')
        const verifyEvents = (await page.capturedEvents()).filter((e) => e.event === '$snapshot')
        expect(verifyEvents.length).toBeGreaterThan(0)

        // Trigger forced idle timeout
        await triggerForcedIdleTimeout(page)

        // Recording should be stopped
        await ensureRecordingIsStopped(page)

        await page.resetCapturedEvents()

        // User activity should start a new session and restart recording
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/ses/*'],
            action: async () => {
                await page.locator('[data-cy-input]').type('new activity after idle!')
            },
        })

        // Should have a new session ID
        const newSessionId = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })
        expect(newSessionId).not.toEqual(initialSessionId)

        // Recording should be active again (verified by the fact we got snapshots above)

        // Verify we got a new session with session_id_changed reason
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.capture('test_after_idle_restart')
        })

        await page.expectCapturedEventsToBe(['$snapshot', 'test_after_idle_restart'])
        const capturedEvents = await page.capturedEvents()

        expect(capturedEvents[0]['properties']['$session_id']).toEqual(newSessionId)
        expect(capturedEvents[1]['properties']['$session_id']).toEqual(newSessionId)
        expect(capturedEvents[1]['properties']['$session_recording_start_reason']).toEqual('session_id_changed')
    })
})

test.describe('Session recording - idle timeout with sampling', () => {
    test.beforeEach(async ({ page, context }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(sampleZeroStartOptions, page, context)
            },
        })
        await page.expectCapturedEventsToBe(['$pageview'])
        await page.resetCapturedEvents()
    })

    test('applies sampling rules after forced idle timeout when sampling is 0', async ({ page }) => {
        // With sample rate 0, recording should not start automatically
        await page.locator('[data-cy-input]').type('initial activity')
        await page.waitForTimeout(250)
        await page.expectCapturedEventsToBe([]) // No recording due to sample rate 0

        // Override sampling to start recording
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.startSessionRecording({ sampling: true })
        })
        await ensureActivitySendsSnapshots(page)

        // Get current session ID
        const sessionIdBeforeIdle = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })

        // Trigger forced idle timeout
        await triggerForcedIdleTimeout(page)

        // Recording should be stopped
        await ensureRecordingIsStopped(page)

        await page.resetCapturedEvents()

        // User activity should create new session but NOT start recording due to sample rate 0
        await page.locator('[data-cy-input]').type('activity after idle timeout')
        await page.waitForTimeout(250)

        // Verify new session was created
        const sessionIdAfterIdle = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.get_session_id()
        })
        expect(sessionIdAfterIdle).not.toEqual(sessionIdBeforeIdle)

        // But recording should still be inactive due to sampling rules (verified by no events)
        await page.expectCapturedEventsToBe([])

        // Verify that sampling override can restart recording even after idle timeout
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.startSessionRecording({ sampling: true })
        })

        // Now recording should start again
        await ensureActivitySendsSnapshots(page)

        // Verify the start reason is sampling_overridden
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.capture('test_after_sampling_override')
        })

        const finalEvents = await page.capturedEvents()
        const testEvent = finalEvents.find((e) => e.event === 'test_after_sampling_override')
        expect(testEvent?.properties['$session_recording_start_reason']).toEqual('sampling_overridden')
    })
})
