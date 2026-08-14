import { BrowserContext, Page, Request } from '@playwright/test'
import { expect, test, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

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

async function startOnSubdomain(page: Page, context: BrowserContext, subdomain: string): Promise<void> {
    await start(
        {
            ...options,
            options: {
                ...options.options,
                api_host: `https://${subdomain}.example.test`,
            },
            url: `https://${subdomain}.example.test/playground/cypress/index.html`,
        },
        page,
        context
    )
    await page.evaluate(() => {
        const posthog = (window as WindowWithPostHog).posthog
        posthog?.persistence?.flush()
        ;(window as WindowWithPostHog).capturedEvents = []
    })
}

function getFlagsPayload(request: Request): Record<string, any> {
    const body = request.postData()
    const data = body?.match(/data=(.*)/)?.[1]
    if (!data) {
        throw new Error('Expected an encoded flags payload')
    }
    return JSON.parse(Buffer.from(decodeURIComponent(data), 'base64').toString())
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
    await context.route('**/playground/cypress/index.html', (route) =>
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
    await expect.poll(() => flagsRequests.length).toBeGreaterThan(0)
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
