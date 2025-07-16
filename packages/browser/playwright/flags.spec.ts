import { expect, test } from './fixtures'
import { Request } from '@playwright/test'
import { PostHog } from '../src/posthog-core'
import { PosthogPage } from './fixtures/posthog'
import { BasePage } from './fixtures/page'
import { NetworkPage } from './fixtures/network'

function getBase64EncodedPayloadFromBody(body: unknown): Record<string, any> {
    if (typeof body !== 'string') {
        throw new Error('Expected body to be a string')
    }
    const dataElement = body.match(/data=(.*)/)?.[1]
    const data = decodeURIComponent(dataElement!)
    return JSON.parse(Buffer.from(data, 'base64').toString())
}

async function initFlags(page: BasePage, posthog: PosthogPage, network: NetworkPage, flagsRequests: Request[]) {
    page.on('request', (request) => {
        if (request.url().includes('/flags/')) {
            flagsRequests.push(request)
        }
    })
    await page.evaluate(() => {
        ;(window as any).__ph_loaded = (ph: PostHog) => {
            ph.identify('new-id')
            ph.group('company', 'id:5', { id: 5, company_name: 'Awesome Inc' })
            ph.group('playlist', 'id:77', { length: 8 })
        }
    })
    const flagsPromise = network.waitForFlags()
    await posthog.init()
    await flagsPromise
}

test.describe('flags', () => {
    test.use({
        flagsOverrides: {
            sessionRecording: {
                endpoint: '/ses/',
            },
            capturePerformance: true,
        },
        url: '/playground/cypress/index.html',
    })

    test('makes flags request on start', async ({ page, posthog, network }) => {
        const flagsRequests: Request[] = []
        await initFlags(page, posthog, network, flagsRequests)
        expect(flagsRequests.length).toBe(1)
        const flagsRequest = flagsRequests[0]
        const flagsPayload = getBase64EncodedPayloadFromBody(flagsRequest.postData())
        expect(flagsPayload).toEqual({
            token: expect.stringMatching(/.+/),
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

    test('does a single flags call on following changes', async ({ page, posthog, network }) => {
        const flagsRequests: Request[] = []
        await initFlags(page, posthog, network, flagsRequests)
        expect(flagsRequests.length).toBe(1)
        await page.evaluate(() => {
            const ph = (window as any).posthog
            ph.group('company', 'id:6')
            ph.group('playlist', 'id:77')
            ph.group('anothergroup', 'id:99')
        })
        await page.waitForResponse('**/flags/**')
        // need a short delay so that the flags request can be captured into the flagsRequests array
        await page.waitForCondition(() => flagsRequests.length >= 2)

        expect(flagsRequests.length).toBe(2)
    })
})
