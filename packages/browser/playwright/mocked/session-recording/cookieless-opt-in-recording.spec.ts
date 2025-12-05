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
    test('reproduces customer issue: cookieless_mode on_reject + opt_out_capturing_by_default', async ({
        page,
        context,
    }) => {
        // NOTE: cookieless_mode: 'on_reject' already behaves like opt_out_capturing_by_default,
        // so using both is redundant, but we test with both to match the customer's exact setup
        const customerConfig: Partial<PostHogConfig> = {
            cross_subdomain_cookie: false,
            capture_pageview: true,
            capture_pageleave: true,
            cookieless_mode: 'on_reject',
            opt_out_capturing_by_default: true,
            opt_out_capturing_persistence_type: 'localStorage',
        }

        // No recorder or snapshot call initially because we're opted out
        void expect(page.waitForResponse('**/*recorder.js*', { timeout: 250 })).rejects.toThrowError('Timeout')
        void expect(page.waitForResponse('**/ses/*', { timeout: 250 })).rejects.toThrowError('Timeout')

        await startWith(customerConfig, page, context)

        // Verify no events are captured initially
        await page.locator('[data-cy-input]').type('hello posthog!')
        await page.waitForTimeout(250)
        await page.expectCapturedEventsToBe([])

        // Now the user gives consent and opts in
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.opt_in_capturing()
                })
            },
        })

        // Verify opt-in event and pageview are captured
        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])

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

    test('cookieless_mode on_reject acts like opt_out_capturing_by_default', async ({ page, context }) => {
        // Test that cookieless_mode: 'on_reject' alone also prevents recording
        // until explicit consent is given (it treats pending consent as opted out)
        const config: Partial<PostHogConfig> = {
            cookieless_mode: 'on_reject',
            capture_pageview: true,
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
                    ph?.opt_in_capturing()
                })
            },
        })

        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])
        await page.resetCapturedEvents()

        await page.locator('[data-cy-input]').type('test after consent')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })

    test('session recording auto-starts after opt_in_capturing without explicit startSessionRecording call', async ({
        page,
        context,
    }) => {
        const customerConfig: Partial<PostHogConfig> = {
            cookieless_mode: 'on_reject',
            opt_out_capturing_by_default: true,
            opt_out_capturing_persistence_type: 'localStorage',
        }

        await startWith(customerConfig, page, context)

        // User opts in but does NOT call startSessionRecording()
        // Recording should auto-start because opt_in_capturing() now calls startIfEnabledOrStop()
        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/*recorder.js*'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as WindowWithPostHog).posthog
                    ph?.opt_in_capturing()
                })
            },
        })

        await page.expectCapturedEventsToBe(['$opt_in', '$pageview'])
        await page.resetCapturedEvents()

        // Verify recording works after opt-in
        await page.locator('[data-cy-input]').type('hello posthog!')
        await pollUntilEventCaptured(page, '$snapshot')
        await assertThatRecordingStarted(page)
    })
})
