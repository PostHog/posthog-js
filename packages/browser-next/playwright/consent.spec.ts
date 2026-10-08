import { expect, test } from '@playwright/test'

test('same-origin tabs share sessions, adopt rotations, and retain their own windows', async ({ context }) => {
    const first = await context.newPage()
    const second = await context.newPage()
    await Promise.all([first.goto('/'), second.goto('/')])

    await first.evaluate(() => window.consentHarness.capture('first'))
    await second.evaluate(() => window.consentHarness.capture('second'))
    const firstSession = await first.evaluate(() => window.consentHarness.session())
    const secondSession = await second.evaluate(() => window.consentHarness.session())
    expect(secondSession.sessionId).toBe(firstSession.sessionId)
    expect(secondSession.windowId).not.toBe(firstSession.windowId)

    await first.evaluate(async () => {
        await window.consentHarness.reset()
        await window.consentHarness.capture('rotated')
    })
    const rotated = await first.evaluate(() => window.consentHarness.session())
    expect(rotated.sessionId).not.toBe(firstSession.sessionId)
    expect(rotated.windowId).not.toBe(firstSession.windowId)

    await second.evaluate(() => window.consentHarness.capture('adopt'))
    const adopted = await second.evaluate(() => window.consentHarness.session())
    expect(adopted.sessionId).toBe(rotated.sessionId)
    expect(adopted.windowId).toBe(secondSession.windowId)
})

test('ordinary reload preserves the active window', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.consentHarness.capture('before-reload'))
    const before = await page.evaluate(() => window.consentHarness.session())

    await page.reload()
    expect(await page.evaluate(() => window.consentHarness.session())).toEqual({
        sessionId: '',
        windowId: '',
        sessionStartTimestamp: 0,
    })
    await page.evaluate(() => window.consentHarness.capture('after-reload'))

    expect(await page.evaluate(() => window.consentHarness.session())).toEqual(before)
})

test('a window.open tab with copied session storage gets its own window', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.consentHarness.capture('opener'))
    const opener = await page.evaluate(() => window.consentHarness.session())

    const popupPromise = page.waitForEvent('popup')
    await page.evaluate(() => window.open('/', '_blank'))
    const popup = await popupPromise
    await popup.waitForLoadState()
    await popup.evaluate(() => window.consentHarness.capture('popup'))
    const duplicate = await popup.evaluate(() => window.consentHarness.session())

    expect(duplicate.sessionId).toBe(opener.sessionId)
    expect(duplicate.windowId).not.toBe(opener.windowId)
})

test('a rapid cross-tab denial purges queued work before a later grant', async ({ context }) => {
    const first = await context.newPage()
    const second = await context.newPage()
    await Promise.all([first.goto('/'), second.goto('/')])

    const originalAnonymousId = await first.evaluate(() => window.consentHarness.anonymousId())
    await first.evaluate(() => window.consentHarness.capture('private-before-denial'))

    await second.evaluate(async () => {
        await window.consentHarness.optOut()
        await window.consentHarness.optIn()
    })

    await expect.poll(() => first.evaluate(() => window.consentHarness.denialEvents())).toBe(1)
    await expect.poll(() => first.evaluate(() => window.consentHarness.anonymousId())).toBe(originalAnonymousId)
    expect(await first.evaluate(() => window.consentHarness.consentValue())).toBe('1')

    await first.evaluate(() => window.consentHarness.flush())
    expect(await first.evaluate(() => window.consentHarness.requests())).toBe(0)
})
