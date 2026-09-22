import { expect, test } from './utils/posthog-playwright-test-base'
import { Request } from '@playwright/test'
import { Compression, FlagsResponse } from '@/types'
import { decompressSync, strFromU8 } from 'fflate'

/**
 * A page that loads customizations.full.js with `defer` runs the script after the inline
 * `posthog.init(...)`, so the `loaded` callback calls the customization before the bundle
 * publishes `window.posthogCustomizations`. The snippet bootstrap queues that call and the
 * bundle replays it, so the flags request still carries the URL person properties.
 */
const CUSTOMIZATIONS_DELAY_MS = 500

function personPropertiesOf(request: Request): Record<string, any> {
    const data = request.postDataBuffer()
    if (!data) {
        throw new Error('Expected body to be present')
    }

    const payload =
        data[0] === 0x1f && data[1] === 0x8b
            ? JSON.parse(strFromU8(decompressSync(data)))
            : JSON.parse(Buffer.from(new URLSearchParams(data.toString()).get('data') || '', 'base64').toString())

    return payload.person_properties || {}
}

test.describe('deferred customizations bundle', () => {
    test('replays the customization the `loaded` callback made before the bundle arrived', async ({
        page,
        context,
    }) => {
        const flagsRequests: Request[] = []
        page.on('request', (request) => {
            if (request.url().includes('/flags/')) {
                flagsRequests.push(request)
            }
        })

        const flagsResponse: Partial<FlagsResponse> = {
            flags: {},
            featureFlags: {},
            featureFlagPayloads: {},
            isAuthenticated: false,
            siteApps: [],
            supportedCompression: [Compression.Base64],
            autocaptureExceptions: false,
            autocapture_opt_out: true,
        }

        await context.route(/\/array\/[^/]+\/config(\?|$)/, (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flagsResponse) })
        )
        await context.route('**/flags/*', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(flagsResponse) })
        )
        // hold the bundle back so the `loaded` callback always runs first, which is the
        // ordering a deferred script produces on a real page
        await context.route('**/static/customizations.full.js', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, CUSTOMIZATIONS_DELAY_MS))
            await route.fulfill({ path: './dist/customizations.full.js' })
        })

        await page.goto('/playground/deferred-customizations/index.html')

        await expect
            .poll(() => flagsRequests.some((request) => '$current_url' in personPropertiesOf(request)), {
                timeout: 10000,
            })
            .toBe(true)
    })
})
