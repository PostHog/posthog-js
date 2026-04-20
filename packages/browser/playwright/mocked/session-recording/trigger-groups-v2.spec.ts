import { RemoteConfig } from '@/types'
import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start, waitForRemoteConfig } from '../utils/setup'

const baseOptions = {
    options: {
        session_recording: {
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
    url: '/playground/cypress/index.html',
}

test.describe('V2 Trigger Groups - session rotation', () => {
    const v2EventTriggerOptions = {
        ...baseOptions,
        flagsResponseOverrides: {
            ...baseOptions.flagsResponseOverrides,
            sessionRecording: {
                ...baseOptions.flagsResponseOverrides.sessionRecording,
                version: 2,
                triggerGroups: [
                    {
                        id: 'g-rot',
                        name: 'rotation-test',
                        sampleRate: 1,
                        conditions: {
                            matchType: 'all',
                            events: [{ name: 'purchase' }],
                        },
                    },
                ],
            } satisfies RemoteConfig['sessionRecording'],
        },
    }

    test.beforeEach(async ({ page, context }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(v2EventTriggerOptions, page, context)
            },
        })
        await waitForRemoteConfig(page)
        await page.expectCapturedEventsToBe(['$pageview'])
        await page.resetCapturedEvents()
    })

    test('clears trigger activation and re-samples on session rotation', async ({ page }) => {
        // Verify initial state: buffering (trigger pending, not yet fired)
        const initialStatus = await page.evaluate(() => {
            return (window as WindowWithPostHog).posthog?.sessionRecording?.status
        })
        expect(initialStatus).toBe('buffering')

        // Capture session A ID
        const sessionA = await page.evaluate(() => {
            return (window as WindowWithPostHog).posthog?.sessionRecording?.sessionId
        })

        // Activate the trigger
        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.capture('purchase')
        })

        const afterActivate = await page.evaluate(() => {
            return (window as WindowWithPostHog).posthog?.sessionRecording?.status
        })
        expect(afterActivate).toBe('sampled')

        // Force session rotation
        await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            ph?.sessionManager?.resetSessionId()
            // Trigger a capture to force the session manager to issue a new ID
            ph?.capture('$pageview')
        })
        await page.waitForTimeout(500)

        // Verify new session ID
        const sessionB = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            return ph?.sessionManager?.checkAndGetSessionAndWindowId(true).sessionId
        })
        expect(sessionB).not.toBe(sessionA)

        // Status should be buffering again — trigger needs to fire in the new session
        const afterRotation = await page.evaluate(() => {
            return (window as WindowWithPostHog).posthog?.sessionRecording?.status
        })
        expect(afterRotation).toBe('buffering')

        // Activate trigger again in session B
        await page.evaluate(() => {
            ;(window as WindowWithPostHog).posthog?.capture('purchase')
        })

        const afterReactivate = await page.evaluate(() => {
            return (window as WindowWithPostHog).posthog?.sessionRecording?.status
        })
        expect(afterReactivate).toBe('sampled')
    })
})

test.describe('V2 Trigger Groups - URL blocklist interaction', () => {
    const v2UrlTriggerWithBlocklistOptions = {
        ...baseOptions,
        flagsResponseOverrides: {
            ...baseOptions.flagsResponseOverrides,
            sessionRecording: {
                ...baseOptions.flagsResponseOverrides.sessionRecording,
                version: 2,
                urlBlocklist: [{ url: '/blocked', matching: 'regex' as const }],
                triggerGroups: [
                    {
                        id: 'g-bl',
                        name: 'blocklist-test',
                        sampleRate: 1,
                        conditions: {
                            matchType: 'any',
                            urls: [{ url: '/app', matching: 'regex' as const }],
                        },
                    },
                ],
            } satisfies RemoteConfig['sessionRecording'],
        },
    }

    test.beforeEach(async ({ page, context }) => {
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await start(v2UrlTriggerWithBlocklistOptions, page, context)
            },
        })
        await waitForRemoteConfig(page)
        await page.expectCapturedEventsToBe(['$pageview'])
        await page.resetCapturedEvents()
    })

    test('pauses on blocklisted URL and resumes with activation intact', async ({ page }) => {
        // Initial: buffering (URL trigger pending)
        const initialStatus = await page.evaluate(() => {
            return (window as WindowWithPostHog).posthog?.sessionRecording?.status
        })
        expect(initialStatus).toBe('buffering')

        // Navigate to a URL that matches the trigger
        await page.evaluate(() => {
            window.history.pushState({}, '', '/app/dashboard')
        })
        await page.locator('[data-cy-input]').fill('activating trigger')
        await page.waitForTimeout(300)

        const afterActivate = await page.evaluate(() => {
            return (window as WindowWithPostHog).posthog?.sessionRecording?.status
        })
        expect(afterActivate).toBe('sampled')

        // Navigate to a blocklisted URL — should pause
        await page.evaluate(() => {
            window.history.pushState({}, '', '/blocked/sensitive-page')
        })
        await page.locator('[data-cy-input]').fill('on blocked page')
        await page.waitForTimeout(300)

        const afterBlocked = await page.evaluate(() => {
            return (window as WindowWithPostHog).posthog?.sessionRecording?.status
        })
        expect(afterBlocked).toBe('paused')

        // Navigate back to a non-blocked URL — should resume as sampled (activation persists)
        await page.evaluate(() => {
            window.history.pushState({}, '', '/app/other-page')
        })
        await page.locator('[data-cy-input]').fill('back from blocked')
        await page.waitForTimeout(300)

        const afterResume = await page.evaluate(() => {
            return (window as WindowWithPostHog).posthog?.sessionRecording?.status
        })
        expect(afterResume).toBe('sampled')
    })

    test('activation persists even when navigating to non-matching, non-blocked URLs', async ({ page }) => {
        // Activate via URL trigger
        await page.evaluate(() => {
            window.history.pushState({}, '', '/app/dashboard')
        })
        await page.locator('[data-cy-input]').fill('activate')
        await page.waitForTimeout(300)

        const activated = await page.evaluate(() => {
            return (window as WindowWithPostHog).posthog?.sessionRecording?.status
        })
        expect(activated).toBe('sampled')

        // Navigate to a URL that matches neither trigger nor blocklist
        await page.evaluate(() => {
            window.history.pushState({}, '', '/settings/profile')
        })
        await page.locator('[data-cy-input]').fill('on settings')
        await page.waitForTimeout(300)

        // Should still be sampled — URL trigger activation is sticky for the session
        const afterNav = await page.evaluate(() => {
            return (window as WindowWithPostHog).posthog?.sessionRecording?.status
        })
        expect(afterNav).toBe('sampled')
    })
})
