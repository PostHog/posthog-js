import { expect, test } from './utils/posthog-playwright-test-base'
import { Request } from '@playwright/test'
import { start } from './utils/setup'
import { PostHog } from '../src/posthog-core'
import { getBase64EncodedPayloadFromBody } from '../cypress/support/compression'

const startOptions = {
    options: {},
    decideResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('decide', () => {
    test('makes decide request on start', async ({ page, context }) => {
        // we want to grab any requests to decide so we can inspect their payloads
        const decideRequests: Request[] = []

        page.on('request', (request) => {
            if (request.url().includes('/decide/')) {
                decideRequests.push(request)
            }
        })

        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                },
                runBeforePostHogInit: async (page) => {
                    // it's tricky to pass functions as args the way posthog config is passed in playwright
                    // so here we set the function on the window object
                    // and then call it in the loaded function during init
                    await page.evaluate(() => {
                        ;(window as any).__ph_loaded = (ph: PostHog) => {
                            ph.identify('new-id')
                            ph.group('company', 'id:5', { id: 5, company_name: 'Awesome Inc' })
                            ph.group('playlist', 'id:77', { length: 8 })
                        }
                    })
                },
            },
            page,
            context
        )

        expect(decideRequests.length).toBe(1)
        const decideRequest = decideRequests[0]
        const decidePayload = getBase64EncodedPayloadFromBody(decideRequest.postData())
        expect(decidePayload).toEqual({
            token: 'test token',
            distinct_id: 'new-id',
            person_properties: {},
            $anon_distinct_id: decidePayload.$anon_distinct_id,
            groups: {
                company: 'id:5',
                playlist: 'id:77',
            },
            group_properties: {
                company: { id: 5, company_name: 'Awesome Inc' },
                playlist: { length: 8 },
            },
        })
    })

    test('does a single decide call on following changes', async ({ page, context }) => {
        // we want to grab any requests to decide so we can inspect their payloads
        const decideRequests: Request[] = []

        page.on('request', (request) => {
            if (request.url().includes('/decide/')) {
                decideRequests.push(request)
            }
        })

        await start(
            {
                ...startOptions,
                options: {
                    ...startOptions.options,
                },
                runBeforePostHogInit: async (page) => {
                    // it's tricky to pass functions as args the way posthog config is passed in playwright
                    // so here we set the function on the window object
                    // and then call it in the loaded function during init
                    await page.evaluate(() => {
                        ;(window as any).__ph_loaded = (ph: PostHog) => {
                            ph.identify('new-id')
                            ph.group('company', 'id:5', { id: 5, company_name: 'Awesome Inc' })
                            ph.group('playlist', 'id:77', { length: 8 })
                        }
                    })
                },
            },
            page,
            context
        )

        expect(decideRequests.length).toBe(1)

        await page.waitingForNetworkCausedBy(['**/decide/**'], async () => {
            await page.evaluate(() => {
                const ph = (window as any).posthog
                ph.group('company', 'id:6')
                ph.group('playlist', 'id:77')
                ph.group('anothergroup', 'id:99')
            })
        })

        expect(decideRequests.length).toBe(2)
    })

    test('does not capture session recordings when decide is disabled', async ({ page, context }) => {
        await start({ options: { advanced_disable_decide: true }, waitForDecide: false }, page, context)

        await page.locator('[data-cy-custom-event-button]').click()

        const callsToSessionRecording = page.waitForResponse('**/ses/')

        await page.locator('[data-cy-input]').type('hello posthog!')

        void callsToSessionRecording.then(() => {
            throw new Error('Session recording call was made and should not have been')
        })
        await page.waitForTimeout(200)

        const capturedEvents = await page.capturedEvents()
        // no snapshot events sent
        expect(capturedEvents.map((x) => x.event)).toEqual(['$pageview', 'custom-event'])
    })
})
