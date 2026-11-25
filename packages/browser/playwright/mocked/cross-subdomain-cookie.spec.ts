import { BrowserContext, Page, Request } from '@playwright/test'
import { expect, test, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { decompressSync, strFromU8 } from 'fflate'

const options = {
    waitForFlags: true,
    options: {
        cookieWinsOnConflict: true,
        capture_pageview: false,
        capture_pageleave: false,
        cross_subdomain_cookie: true,
        cookie_persisted_properties: ['cross_domain_property'],
        persistence_save_debounce_ms: 250,
    },
    flagsResponseOverrides: {
        sessionRecording: undefined,
        autocapture_opt_out: true,
    },
}

async function startOnSubdomain(
    page: Page,
    context: BrowserContext,
    subdomain: string,
    query: string = ''
): Promise<void> {
    await start(
        {
            ...options,
            options: {
                ...options.options,
                api_host: `https://${subdomain}.example.test`,
            },
            url: `https://${subdomain}.example.test/playground/cypress/index.html${query}`,
        },
        page,
        context
    )
    await page.waitForFunction(() => Boolean((window as WindowWithPostHog).posthog?.__loaded))
    await page.evaluate(() => {
        const posthog = (window as WindowWithPostHog).posthog
        posthog?.persistence?.flush()
        ;(window as WindowWithPostHog).capturedEvents = []
    })
}

function getFlagsPayload(request: Request): Record<string, any> {
    const data = request.postDataBuffer()
    if (!data) {
        throw new Error('Expected flags request body')
    }
    if (data[0] === 0x1f && data[1] === 0x8b) {
        return JSON.parse(strFromU8(decompressSync(data)))
    }

    const encodedData = new URLSearchParams(data.toString()).get('data')
    if (!encodedData) {
        throw new Error('Expected a gzip or Base64 encoded flags payload')
    }
    return JSON.parse(Buffer.from(encodedData, 'base64').toString())
}

async function distinctId(page: Page): Promise<string | undefined> {
    return page.evaluate(() => (window as WindowWithPostHog).posthog?.get_distinct_id())
}

async function captureDistinctId(page: Page, event: string): Promise<string | undefined> {
    await page.evaluate((eventName) => (window as WindowWithPostHog).posthog?.capture(eventName), event)
    const capturedEvents = await page.evaluate(() => (window as WindowWithPostHog).capturedEvents || [])
    return capturedEvents.find((capturedEvent) => capturedEvent.event === event)?.properties.distinct_id as
        | string
        | undefined
}

test.beforeEach(async ({ context }) => {
    await context.route(/\/playground\/cypress\/index\.html(\?|$)/, (route) =>
        route.fulfill({ path: './playground/cypress/index.html' })
    )
})

test('already-open sibling subdomains adopt identify and reset cookie changes', async ({ page, context }) => {
    await startOnSubdomain(page, context, 'a')
    const firstAnonymousId = await distinctId(page)
    expect(firstAnonymousId).toBeTruthy()

    const sibling = await context.newPage()
    await startOnSubdomain(sibling, context, 'b')
    expect(await distinctId(sibling)).toBe(firstAnonymousId)

    await sibling.evaluate(() => {
        const posthog = (window as WindowWithPostHog).posthog
        posthog?.register({ cross_domain_property: 'old-user' })
        posthog?.identify('identified-user')
    })
    expect(await captureDistinctId(page, 'after-sibling-identify')).toBe('identified-user')
    expect(
        await page.evaluate(() => (window as WindowWithPostHog).posthog?.get_property('cross_domain_property'))
    ).toBe('old-user')

    await page.evaluate(() => {
        const posthog = (window as WindowWithPostHog).posthog
        posthog?.register({ previous_user_property: 'private-value' })
        posthog?.setPersonPropertiesForFlags({ plan: 'pro' }, false)
        posthog?.group('organization', 'previous-organization', { plan: 'enterprise' })
    })
    const flagsRequests: Request[] = []
    page.on('request', (request) => {
        if (request.url().includes('/flags/')) {
            flagsRequests.push(request)
        }
    })

    await sibling.evaluate(() => (window as WindowWithPostHog).posthog?.reset())
    const resetAnonymousId = await distinctId(sibling)
    expect(resetAnonymousId).toBeTruthy()
    expect(resetAnonymousId).not.toBe('identified-user')
    expect(await captureDistinctId(page, 'after-sibling-reset')).toBe(resetAnonymousId)
    const resetEvent = (await page.capturedEvents()).find((event) => event.event === 'after-sibling-reset')
    expect(resetEvent?.properties).not.toHaveProperty('$feature/session-recording-player')
    expect(resetEvent?.properties).not.toHaveProperty('$groups')
    expect(resetEvent?.properties).not.toHaveProperty('previous_user_property')
    expect(
        await page.evaluate(() => (window as WindowWithPostHog).posthog?.get_property('cross_domain_property'))
    ).toBeUndefined()
    expect(
        await page.evaluate(() => (window as WindowWithPostHog).posthog?.get_property('previous_user_property'))
    ).toBeUndefined()
    await expect
        .poll(() => {
            const request = flagsRequests[flagsRequests.length - 1]
            return request && getFlagsPayload(request).distinct_id
        })
        .toBe(resetAnonymousId)
    const flagsPayload = getFlagsPayload(flagsRequests[flagsRequests.length - 1])
    expect(flagsPayload.distinct_id).toBe(resetAnonymousId)
    expect(flagsPayload.person_properties).not.toHaveProperty('plan')
    expect(flagsPayload.group_properties).toBeUndefined()

    // Capturing from the reset tab proves the stale tab did not republish the
    // old cookie-backed property after it observed the reset.
    await captureDistinctId(sibling, 'after-stale-tab-reset-sync')
    expect(
        await sibling.evaluate(() => (window as WindowWithPostHog).posthog?.get_property('cross_domain_property'))
    ).toBeUndefined()
})

test('explicit identify wins after an unobserved sibling cookie update', async ({ page, context }) => {
    await startOnSubdomain(page, context, 'a')

    const sibling = await context.newPage()
    await startOnSubdomain(sibling, context, 'b')

    await sibling.evaluate(() => (window as WindowWithPostHog).posthog?.identify('sibling-user'))
    await page.evaluate(() => (window as WindowWithPostHog).posthog?.identify('explicit-user'))

    expect(await distinctId(page)).toBe('explicit-user')
    expect(await captureDistinctId(sibling, 'after-explicit-identify')).toBe('explicit-user')
})

test('a persistence-disabled subdomain does not adopt a sibling identity', async ({ page, context }) => {
    await startOnSubdomain(page, context, 'a')
    const firstAnonymousId = await distinctId(page)
    expect(firstAnonymousId).toBeTruthy()

    const sibling = await context.newPage()
    await startOnSubdomain(sibling, context, 'b')
    expect(await distinctId(sibling)).toBe(firstAnonymousId)

    await page.evaluate(() => (window as WindowWithPostHog).posthog?.set_config({ disable_persistence: true }))
    await sibling.evaluate(() => (window as WindowWithPostHog).posthog?.identify('identified-user'))

    expect(await captureDistinctId(page, 'after-disabled-sibling-identify')).toBe(firstAnonymousId)
    expect(await distinctId(page)).toBe(firstAnonymousId)
})

test('preserves campaign params when a campaign link lands on an unvisited sibling subdomain mid-session', async ({
    page,
    context,
}) => {
    await startOnSubdomain(page, context, 'b')
    await page.evaluate(() => {
        const posthog = (window as WindowWithPostHog).posthog
        posthog?.capture('$pageview')
        posthog?.persistence?.flush()
    })
    const initialPageview = (await page.capturedEvents()).find((event) => event.event === '$pageview')
    expect(initialPageview?.properties.distinct_id).toBeTruthy()
    expect(initialPageview?.properties.$session_id).toBeTruthy()
    expect(initialPageview?.properties.$device_id).toBeTruthy()

    await startOnSubdomain(page, context, 'a', '?utm_source=test&utm_medium=qa&utm_campaign=xsub')
    await page.evaluate(() => {
        const posthog = (window as WindowWithPostHog).posthog
        posthog?.capture('$pageview')
        posthog?.capture('after-landing')
    })

    const landingEvents = await page.capturedEvents()
    const landingPageview = landingEvents.find((event) => event.event === '$pageview')
    const followUpEvent = landingEvents.find((event) => event.event === 'after-landing')

    expect(landingPageview?.properties).toMatchObject({
        distinct_id: initialPageview?.properties.distinct_id,
        $device_id: initialPageview?.properties.$device_id,
        $session_id: initialPageview?.properties.$session_id,
        utm_source: 'test',
        utm_medium: 'qa',
        utm_campaign: 'xsub',
    })
    expect(followUpEvent?.properties).toMatchObject({
        distinct_id: initialPageview?.properties.distinct_id,
        $session_id: initialPageview?.properties.$session_id,
        utm_source: 'test',
        utm_medium: 'qa',
        utm_campaign: 'xsub',
    })
})

test('preserves campaign params when landing on a sibling subdomain after a reset', async ({ page, context }) => {
    await startOnSubdomain(page, context, 'a')
    await page.evaluate(() => {
        const posthog = (window as WindowWithPostHog).posthog
        posthog?.identify('identified-user')
        posthog?.register_for_session({ stale_session_prop: 'old-user' })
        posthog?.persistence?.flush()
    })

    const sibling = await context.newPage()
    await startOnSubdomain(sibling, context, 'b')
    await sibling.evaluate(() => (window as WindowWithPostHog).posthog?.reset())
    const resetAnonymousId = await distinctId(sibling)
    expect(resetAnonymousId).toBeTruthy()
    expect(resetAnonymousId).not.toBe('identified-user')
    await sibling.close()

    await startOnSubdomain(page, context, 'a', '?utm_source=after-reset&utm_medium=cpc&utm_campaign=brand')
    await page.evaluate(() => (window as WindowWithPostHog).posthog?.capture('$pageview'))

    const landingPageview = (await page.capturedEvents()).find((event) => event.event === '$pageview')
    expect(landingPageview?.properties).toMatchObject({
        distinct_id: resetAnonymousId,
        utm_source: 'after-reset',
        utm_medium: 'cpc',
        utm_campaign: 'brand',
    })
    expect(landingPageview?.properties).not.toHaveProperty('stale_session_prop')
})
