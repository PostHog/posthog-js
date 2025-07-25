import { expect, test } from './utils/posthog-playwright-test-base'
import { Request } from '@playwright/test'
import { start } from './utils/setup'
import { PostHog } from '@/posthog-core'
import { pollUntilCondition } from './utils/event-capture-utils'

function getBase64EncodedPayloadFromBody(body: unknown): Record<string, any> {
    if (typeof body !== 'string') {
        throw new Error('Expected body to be a string')
    }
    const dataElement = body.match(/data=(.*)/)?.[1]
    const data = decodeURIComponent(dataElement!)
    return JSON.parse(Buffer.from(data, 'base64').toString())
}

const startOptions = {
    options: {},
    flagsResponseOverrides: {
        sessionRecording: {
            endpoint: '/ses/',
        },
        capturePerformance: true,
    },
    url: '/playground/cypress/index.html',
}

test.describe('flags', () => {
    // we want to grab any requests to flags so we can inspect their payloads
    let flagsRequests: Request[] = []

    test.beforeEach(async ({ page, context }) => {
        flagsRequests = []

        page.on('request', (request) => {
            if (request.url().includes('/flags/')) {
                flagsRequests.push(request)
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
    })

    test('makes flags request on start', async () => {
        expect(flagsRequests.length).toBe(1)
        const flagsRequest = flagsRequests[0]
        const flagsPayload = getBase64EncodedPayloadFromBody(flagsRequest.postData())
        expect(flagsPayload).toEqual({
            token: 'test token',
            distinct_id: 'new-id',
            person_properties: {
                $initial__kx: null,
                $initial_current_url: 'http://localhost:2345/playground/cypress/index.html',
                $initial_dclid: null,
                $initial_epik: null,
                $initial_fbclid: null,
                $initial_gad_source: null,
                $initial_gbraid: null,
                $initial_gclid: null,
                $initial_gclsrc: null,
                $initial_host: 'localhost:2345',
                $initial_igshid: null,
                $initial_irclid: null,
                $initial_li_fat_id: null,
                $initial_mc_cid: null,
                $initial_msclkid: null,
                $initial_pathname: '/playground/cypress/index.html',
                $initial_qclid: null,
                $initial_rdt_cid: null,
                $initial_referrer: '$direct',
                $initial_referring_domain: '$direct',
                $initial_sccid: null,
                $initial_ttclid: null,
                $initial_twclid: null,
                $initial_utm_campaign: null,
                $initial_utm_content: null,
                $initial_utm_medium: null,
                $initial_utm_source: null,
                $initial_utm_term: null,
                $initial_wbraid: null,
            },
            $anon_distinct_id: flagsPayload.$anon_distinct_id,
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

    test('does a single flags call on following changes', async ({ page }) => {
        expect(flagsRequests.length).toBe(1)

        await page.waitingForNetworkCausedBy({
            urlPatternsToWaitFor: ['**/flags/**'],
            action: async () => {
                await page.evaluate(() => {
                    const ph = (window as any).posthog
                    ph.group('company', 'id:6')
                    ph.group('playlist', 'id:77')
                    ph.group('anothergroup', 'id:99')
                })
            },
        })
        // need a short delay so that the flags request can be captured into the flagsRequests array
        await pollUntilCondition(page, () => flagsRequests.length >= 2)

        expect(flagsRequests.length).toBe(2)
    })
})
