import { expect, test } from '@playwright/test'

test('flags survive reloads and are cleared by reset', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.consentHarness.flagValue('saved'))
    const changes = await page.evaluate(() => window.consentHarness.flagChanges())
    await page.evaluate(() => window.consentHarness.updateFlags({ saved: 'blue' }))
    expect(await page.evaluate(() => window.consentHarness.flagChanges())).toBeGreaterThan(changes)
    await page.evaluate(() => window.consentHarness.capture('unrelated session write'))
    await page.reload()
    expect(await page.evaluate(() => window.consentHarness.flagValue('saved'))).toBe('blue')
    await page.evaluate(() => window.consentHarness.reset())
    expect(await page.evaluate(() => window.consentHarness.flagValue('saved'))).toBeUndefined()
    await page.reload()
    expect(await page.evaluate(() => window.consentHarness.flagValue('saved'))).toBeUndefined()
})
