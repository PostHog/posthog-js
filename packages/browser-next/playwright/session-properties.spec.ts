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
    expect(await page.evaluate(() => window.consentHarness.sessionProperty('flow'))).toBe('checkout')
    await page.evaluate(async () => {
        await window.consentHarness.capture('after_reload')
        await window.consentHarness.flush()
        await window.consentHarness.unregisterForSession('flow')
    })
    expect(await latest(page)).toMatchObject({ flow: 'checkout' })
    await page.reload()
    expect(await page.evaluate(() => window.consentHarness.sessionProperty('flow'))).toBeUndefined()
})

test('independent tabs isolate session properties and copied tabs inherit then diverge', async ({ page, context }) => {
    await page.goto('/')
    await page.evaluate(async () => {
        await window.consentHarness.registerForSession({ owner: 'opener' })
        await window.consentHarness.capture('opener')
    })
    const separate = await context.newPage()
    await separate.goto('/')
    expect(await separate.evaluate(() => window.consentHarness.sessionProperty('owner'))).toBeUndefined()
    await separate.evaluate(() => window.consentHarness.registerForSession({ owner: 'separate' }))
    const popupPromise = page.waitForEvent('popup')
    await page.evaluate(() => window.open('/', '_blank'))
    const popup = await popupPromise
    await popup.waitForLoadState()
    expect(await popup.evaluate(() => window.consentHarness.sessionProperty('owner'))).toBe('opener')
    await popup.evaluate(() => window.consentHarness.registerForSession({ owner: 'copied' }))
    expect(await page.evaluate(() => window.consentHarness.sessionProperty('owner'))).toBe('opener')
    expect(await separate.evaluate(() => window.consentHarness.sessionProperty('owner'))).toBe('separate')
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
    expect(await page.evaluate(() => window.consentHarness.sessionProperty('old_scope'))).toBeUndefined()

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
    expect(await page.evaluate(() => window.consentHarness.sessionProperty('fallback'))).toBe(true)
    await page.reload()
    expect(await page.evaluate(() => window.consentHarness.sessionProperty('fallback'))).toBeUndefined()
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
    expect(await page.evaluate(() => window.consentHarness.sessionProperty('retained'))).toBe(true)
    expect(await page.evaluate(() => window.consentHarness.sessionProperty('removed'))).toBeUndefined()
    await page.evaluate(async () => {
        await window.consentHarness.optIn()
        await window.consentHarness.capture('allowed')
        await window.consentHarness.flush()
    })
    expect(await latest(page)).toMatchObject({ retained: true })
})
