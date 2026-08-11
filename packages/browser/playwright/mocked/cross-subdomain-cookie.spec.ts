import { BrowserContext, Page } from '@playwright/test'
import { expect, test, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

const options = {
    waitForFlags: true,
    options: {
        cookieWinsOnConflict: true,
        capture_pageview: false,
        capture_pageleave: false,
        cross_subdomain_cookie: true,
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

    await sibling.evaluate(() => (window as WindowWithPostHog).posthog?.identify('identified-user'))
    expect(await captureDistinctId(page, 'after-sibling-identify')).toBe('identified-user')

    await sibling.evaluate(() => (window as WindowWithPostHog).posthog?.reset())
    const resetAnonymousId = await distinctId(sibling)
    expect(resetAnonymousId).toBeTruthy()
    expect(resetAnonymousId).not.toBe('identified-user')
    expect(await captureDistinctId(page, 'after-sibling-reset')).toBe(resetAnonymousId)
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
