import { expect, test } from '@playwright/test'

test('flags synchronize across tabs without unrelated core writes overwriting them', async ({ context }) => {
    const first = await context.newPage()
    await first.goto('/')
    const second = await context.newPage()
    await second.goto('/')
    await first.evaluate(() => window.consentHarness.updateFlags({ shared: 'blue' }))
    await expect.poll(() => second.evaluate(() => window.consentHarness.flagChanges())).toBeGreaterThan(0)
    expect(await second.evaluate(() => window.consentHarness.flagValue('shared'))).toBe('blue')
    await second.evaluate(() => window.consentHarness.capture('unrelated session write'))
    await first.reload()
    expect(await first.evaluate(() => window.consentHarness.flagValue('shared'))).toBe('blue')
    await second.evaluate(() => window.consentHarness.updateFlags({ shared: false }))
    await expect.poll(() => first.evaluate(() => window.consentHarness.flagValue('shared'))).toBe(false)
    await first.evaluate(() => window.consentHarness.reset())
    expect(await first.evaluate(() => window.consentHarness.flagValue('shared'))).toBeUndefined()
    // The sibling tab retains its own identity and must not overwrite the reset identity's record.
    await second.evaluate(() => window.consentHarness.updateFlags({ stale: true }))
    expect(await first.evaluate(() => window.consentHarness.flagValue('stale'))).toBeUndefined()
})

test('disposing flags removes native storage observation', async ({ context }) => {
    const first = await context.newPage()
    await first.goto('/')
    const second = await context.newPage()
    await second.goto('/')
    await second.evaluate(() => window.consentHarness.dispose())
    const changes = await second.evaluate(() => window.consentHarness.flagChanges())
    await first.evaluate(() => window.consentHarness.updateFlags({ late: true }))
    await second.waitForTimeout(50)
    expect(await second.evaluate(() => window.consentHarness.flagChanges())).toBe(changes)
})
