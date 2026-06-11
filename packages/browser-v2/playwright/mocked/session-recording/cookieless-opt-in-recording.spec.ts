import { expect, test, WindowWithPostHog } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { BrowserContext, Page } from '@playwright/test'
import { PostHogConfig } from '@/types'
import { assertThatRecordingStarted, pollUntilEventCaptured } from '../utils/event-capture-utils'

async function startWith(config: Partial<PostHogConfig>, page: Page, context: BrowserContext) {
    const flagsResponse = page.waitForResponse('**/flags/*')

    await start(
        {
            options: config,
            flagsResponseOverrides: {
                sessionRecording: {
                    endpoint: '/ses/',
                },
                capturePerformance: true,
                autocapture_opt_out: true,
            },
            url: './playground/cypress/index.html',
        },
        page,
        context
    )

    await flagsResponse
}

test.describe('Session Recording - cookieless mode with opt-in', () => {
    test('reproduces customer issue: cookielessMode on_reject + optOutCapturingByDefault', async ({
        page,
        context,
    }) => {
        // NOTE: cookielessMode: 'on_reject' already behaves like optOutCapturingByDefault,
        // so using both is redundant, but we test with both to match the customer's exact setup
        const customerConfig: Partial<PostHogConfig> = {
            crossSubdomainCookie: false,
            capturePageview: true,
            capturePageleave: true,
            cookielessMode: 'on_reject',
            optOutCapturingByDefault: true,
            optOutCapturingPersistenceType: 'localStorage',
        }

        // No recorder or snapshot call initially because we're opted out
        void expect(page.waitForResponse('**/*recorder.js*', { timeout: 250 })).rejects.toThrowError('Timeout')
        void expect(page.waitForResponse('**/ses/*', { timeout: 250 })).rejects.toThrowError('Timeout')

        await startWith(customerConfig, page, context)

        // Initial cookieless pageview fires at init (the fix for #2841)
        await page.locator('[data-cy-input]').type('hello posthog!')
        await page.waitForTimeout(250)
        await page.expectCapturedEventsToBe(['$pageview'])

        // Now the user gives consent and opts in
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.optInCapturing()
                })
            },
        })

        // Verify opt-in event is captured (pageview already fired at init, so no second one)
        await page.expectCapturedEventsToBe(['$pageview', '$opt_in'])

        // Check localStorage to confirm opt-in is stored
        const optInValue = await page.evaluate(() => {
            const ph = (window as WindowWithPostHog).posthog
            const token = ph?.config.token
            return localStorage.getItem(`__ph_opt_in_out_${token}`)
        })
        expect(optInValue).toBe('1')

        // Reset captured events to check for recording
        await page.resetCapturedEvents()

        // Now interact and verify session recording works
        await page.locator('[data-cy-input]').type('test after consent')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })

    test('cookielessMode on_reject acts like optOutCapturingByDefault', async ({ page, context }) => {
        // Test that cookielessMode: 'on_reject' alone also prevents recording
        // until explicit consent is given (it treats pending consent as opted out)
        const config: Partial<PostHogConfig> = {
            cookielessMode: 'on_reject',
            capturePageview: true,
        }

        // No recorder should load initially because on_reject treats pending consent as opted out
        void expect(page.waitForResponse('**/*recorder.js*', { timeout: 250 })).rejects.toThrowError('Timeout')
        void expect(page.waitForResponse('**/ses/*', { timeout: 250 })).rejects.toThrowError('Timeout')

        await startWith(config, page, context)

        // No events should be captured initially
        await page.locator('[data-cy-input]').type('hello posthog!')
        await page.waitForTimeout(250)
        await page.expectCapturedEventsToBe([])

        // Now opt in - recording should start automatically
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.optInCapturing()
                })
            },
        })

        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])
        await page.resetCapturedEvents()

        await page.locator('[data-cy-input]').type('test after consent')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })

    test('session recording auto-starts after optInCapturing without explicit startSessionRecording call', async ({
        page,
        context,
    }) => {
        const customerConfig: Partial<PostHogConfig> = {
            cookielessMode: 'on_reject',
            optOutCapturingByDefault: true,
            optOutCapturingPersistenceType: 'localStorage',
        }

        await startWith(customerConfig, page, context)

        // User opts in but does NOT call startSessionRecording()
        // Recording should auto-start because optInCapturing() now calls startIfEnabledOrStop()
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.optInCapturing()
                })
            },
        })

        await page.expectCapturedEventsToBe(['$pageview', '$opt_in'])
        await page.resetCapturedEvents()

        // Verify recording works after opt-in
        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })
})
