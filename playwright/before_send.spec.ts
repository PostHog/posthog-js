import { expect, test, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { BeforeSendFn } from '../src/types'

const startOptions = {
    options: {
        session_recording: {},
    },
    decideResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
    },
    url: './playground/cypress-full/index.html',
}

test.describe('before_send', () => {
    test('can sample and edit with before_send', async ({ page, context }) => {
        await start(startOptions, page, context)

        await page.evaluate(() => {
            const posthog = (window as WindowWithPostHog).posthog
            if (!posthog) {
                throw new Error('PostHog is not initialized')
            }
            let counter = 0
            // box the original before_send function
            const og: BeforeSendFn[] = Array.isArray(posthog.config.before_send)
                ? posthog.config.before_send
                : posthog.config.before_send !== undefined
                  ? [posthog.config.before_send]
                  : []

            posthog.config.before_send = [
                (cr) => {
                    if (!cr) {
                        return null
                    }

                    if (cr.event === 'custom-event') {
                        counter++
                        if (counter === 2) {
                            return null
                        }
                    }
                    if (cr.event === '$autocapture') {
                        return {
                            ...cr,
                            event: 'redacted',
                        }
                    }
                    return cr
                },
                // these tests rely on existing before_send function to capture events
                // so we have to add it back in here
                ...og,
            ]
        })

        await page.locator('[data-cy-custom-event-button]').click()
        await page.locator('[data-cy-custom-event-button]').click()

        const captures = (await page.capturedEvents()).map((x) => x.event)

        expect(captures).toEqual([
            // before adding the new before sendfn
            '$pageview',
            'redacted',
            'custom-event',
            // second button click only has the redacted autocapture event
            'redacted',
            // because the second custom-event is rejected
        ])
    })
})
