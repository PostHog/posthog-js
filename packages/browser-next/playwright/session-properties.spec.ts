import { expect, test } from '@playwright/test'

const latest = async (page: import('@playwright/test').Page): Promise<Record<string, unknown> | undefined> =>
    page.evaluate(() => {
        const body = window.consentHarness.delivered()
        return body ? JSON.parse(body).batch.at(-1)?.properties : undefined
    })

test('session properties survive reload and single-key removal in native sessionStorage', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(async () => {
        await window.consentHarness.registerForSession({ flow: 'checkout' })
        await window.consentHarness.capture('before_reload')
        await window.consentHarness.flush()
    })
    expect(await latest(page)).toMatchObject({ flow: 'checkout' })
    await page.reload()
    await page.evaluate(async () => {
        await window.consentHarness.capture('after_reload')
        await window.consentHarness.flush()
        await window.consentHarness.unregisterForSession('flow')
    })
    expect(await latest(page)).toMatchObject({ flow: 'checkout' })
    await page.reload()
    await page.evaluate(async () => {
        await window.consentHarness.capture('after_removal')
        await window.consentHarness.flush()
    })
    expect(await latest(page)).not.toHaveProperty('flow')
})

test('independent tabs isolate session properties and copied tabs inherit then diverge', async ({ page, context }) => {
    await page.goto('/')
    await page.evaluate(async () => {
        await window.consentHarness.registerForSession({ owner: 'opener' })
        await window.consentHarness.capture('opener')
    })
    const separate = await context.newPage()
    await separate.goto('/')
    await separate.evaluate(async () => {
        await window.consentHarness.capture('isolated')
        await window.consentHarness.flush()
    })
    expect(await latest(separate)).not.toHaveProperty('owner')
    await separate.evaluate(() => window.consentHarness.registerForSession({ owner: 'separate' }))
    const popupPromise = page.waitForEvent('popup')
    await page.evaluate(() => window.open('/', '_blank'))
    const popup = await popupPromise
    await popup.waitForLoadState()
    await popup.evaluate(async () => {
        await window.consentHarness.capture('inherited')
        await window.consentHarness.flush()
    })
    expect(await latest(popup)).toMatchObject({ owner: 'opener' })
    await popup.evaluate(async () => {
        await window.consentHarness.registerForSession({ owner: 'copied' })
        await window.consentHarness.capture('copied')
        await window.consentHarness.flush()
    })
    expect(await latest(popup)).toMatchObject({ owner: 'copied' })
    await page.evaluate(async () => {
        await window.consentHarness.capture('after_copy')
        await window.consentHarness.flush()
    })
    expect(await latest(page)).toMatchObject({ owner: 'opener' })
    await separate.evaluate(async () => {
        await window.consentHarness.capture('after_copy')
        await window.consentHarness.flush()
    })
    expect(await latest(separate)).toMatchObject({ owner: 'separate' })
})

test('fresh session registration survives idle rotation with native tab storage', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(async () => {
        await window.consentHarness.registerForSession({ old_scope: true })
        await window.consentHarness.capture('before')
        await window.consentHarness.flush()
        const advanced = Date.now() + 1_800_001
        Date.now = () => advanced
        await window.consentHarness.registerForSession({ flow: 'checkout' })
        await window.consentHarness.capture('checkout_started')
        await window.consentHarness.flush()
    })
    expect(await latest(page)).toMatchObject({ flow: 'checkout' })
    expect(await latest(page)).not.toHaveProperty('old_scope')
})

test('the first idle-rotated event and adopted session exclude prior session properties', async ({ page, context }) => {
    await page.goto('/')
    await page.evaluate(async () => {
        await window.consentHarness.registerForSession({ old_scope: true })
        await window.consentHarness.capture('before')
        await window.consentHarness.flush()
        const advanced = Date.now() + 1_800_001
        Date.now = () => advanced
        await window.consentHarness.capture('rotated')
        await window.consentHarness.flush()
    })
    expect(await latest(page)).not.toHaveProperty('old_scope')

    await page.evaluate(() => window.consentHarness.registerForSession({ before_adoption: true }))
    const other = await context.newPage()
    await other.goto('/')
    await other.evaluate(async () => {
        await window.consentHarness.reset()
        await window.consentHarness.capture('new_session')
    })
    await page.evaluate(async () => {
        await window.consentHarness.capture('adopted')
        await window.consentHarness.flush()
    })
    expect(await latest(page)).not.toHaveProperty('before_adoption')
})

test('unavailable native session storage uses per-instance memory across captures but not reload', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'sessionStorage', {
            configurable: true,
            get() {
                throw new Error('session storage unavailable')
            },
        })
    })
    await page.goto('/')
    await page.evaluate(async () => {
        await window.consentHarness.registerForSession({ fallback: true })
        await window.consentHarness.capture('memory_fallback')
        await window.consentHarness.flush()
    })
    expect(await latest(page)).toMatchObject({ fallback: true })
    await page.reload()
    await page.evaluate(async () => {
        await window.consentHarness.capture('after_reload')
        await window.consentHarness.flush()
    })
    expect(await latest(page)).not.toHaveProperty('fallback')
})

test('denial permits local session registration without creating window or session identity', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(async () => {
        await window.consentHarness.optOut()
        await window.consentHarness.registerForSession({ retained: true, removed: true })
        await window.consentHarness.unregisterForSession('removed')
        await window.consentHarness.capture('denied')
    })
    expect(await page.evaluate(() => window.consentHarness.session())).toBeUndefined()
    expect(await page.evaluate(() => sessionStorage.getItem('ph_browser_next_playwright_window_id'))).toBeNull()
    const stored = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem('ph_ph_browser_next_playwright_posthog_browser_v2_tab_analytics') ?? '{}')
    )
    expect(stored.superProperties).toEqual({ retained: true })
    await page.evaluate(async () => {
        await window.consentHarness.optIn()
        await window.consentHarness.capture('allowed')
        await window.consentHarness.flush()
    })
    expect(await latest(page)).toMatchObject({ retained: true })
})
