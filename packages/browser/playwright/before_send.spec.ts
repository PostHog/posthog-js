import { CaptureResult } from '../src/types'
import { test } from './fixtures'
import { WindowWithPostHog } from './fixtures/posthog'

const startOptions = {
    posthogOptions: {
        session_recording: {},
    },
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
    },
    url: '/playground/cypress-full/index.html',
}

test.describe('before_send', () => {
    test.use(startOptions)

    test('can sample and edit with before_send', async ({ page, posthog, events }) => {
        await page.evaluate(() => {
            let counter = 0
            ;(window as WindowWithPostHog)['before_send'] = (cr: CaptureResult) => {
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
            }
        })

        await posthog.init({}, ['before_send'])
        await page.locator('[data-cy-custom-event-button]').click()
        await page.locator('[data-cy-custom-event-button]').click()
        events.expectMatchList([
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
