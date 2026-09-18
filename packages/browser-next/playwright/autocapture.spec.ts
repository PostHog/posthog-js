import { expect, test } from '@playwright/test'

for (const mode of ['dynamic', 'surveys-first', 'autocapture-first'] as const) {
    test(`${mode} autocapture activates a selector-targeted survey on an SVG child click`, async ({ page }) => {
        await page.goto('/')
        await page.evaluate((mode) => window.autocaptureHarness.initialize(mode), mode)
        expect(await page.evaluate(() => window.autocaptureHarness.eligible())).toBe(false)
        await page.locator('.trigger circle').click()
        expect(await page.evaluate(() => window.autocaptureHarness.eligible())).toBe(true)
        const event = await page.evaluate(() =>
            window.autocaptureHarness.events().find(({ event }) => event === '$autocapture')
        )
        expect(event?.properties.$element_selectors).toContain('.trigger')
        await page.evaluate(() => window.autocaptureHarness.display())
        await expect(page.getByText('How was that click?')).toBeVisible()
        await page.evaluate(() => window.autocaptureHarness.dispose())
        await expect(page.locator('.PostHogSurvey-action-survey')).toHaveCount(0)
    })
}
test('late survey definitions replace selectors and preserve consent/privacy/disposal', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.autocaptureHarness.initialize('dynamic', true))
    await page.locator('#blocked').click()
    expect(await page.evaluate(() => window.autocaptureHarness.events())).toEqual([])
    await page.evaluate(() => window.autocaptureHarness.release())
    await expect.poll(() => page.evaluate(() => window.autocaptureHarness.requests())).toBe(1)
    expect(await page.evaluate(() => window.autocaptureHarness.eligible())).toBe(false)
    await page.evaluate(() => window.autocaptureHarness.optOut())
    await page.locator('.trigger circle').click()
    expect(await page.evaluate(() => window.autocaptureHarness.events())).toEqual([])
    await page.evaluate(() => window.autocaptureHarness.optIn())
    await page.locator('.trigger circle').click()
    expect(await page.evaluate(() => window.autocaptureHarness.eligible())).toBe(true)
    await page.evaluate(() => window.autocaptureHarness.clearSelectors())
    await page.locator('.trigger circle').click()
    const events = await page.evaluate(() =>
        window.autocaptureHarness.events().filter(({ event }) => event === '$autocapture')
    )
    expect(events.at(-1)?.properties.$element_selectors ?? []).toEqual([])
    await page.evaluate(() => window.autocaptureHarness.dispose())
    await page.locator('.trigger circle').click()
    expect(
        await page.evaluate(() => window.autocaptureHarness.events().filter(({ event }) => event === '$autocapture'))
    ).toHaveLength(events.length)
})
test('masking retains action selectors without exposing text or attributes', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.autocaptureHarness.initialize('autocapture-first', false, true))
    await page.locator('.trigger circle').click()
    const event = await page.evaluate(() =>
        window.autocaptureHarness.events().find(({ event }) => event === '$autocapture')
    )
    expect(event?.properties.$element_selectors).toContain('.trigger')
    expect(JSON.stringify(event?.properties)).not.toContain('hidden')
    expect(JSON.stringify(event?.properties)).not.toContain('Continue')
    expect(await page.evaluate(() => window.autocaptureHarness.eligible())).toBe(true)
})

test('URL-constrained DOM actions match local context without adding it to the captured event', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.autocaptureHarness.initialize('dynamic', false, false, '/eligible'))
    await page.locator('.trigger circle').click()
    expect(await page.evaluate(() => window.autocaptureHarness.eligible())).toBe(false)
    await page.evaluate(() => history.pushState(null, '', '/eligible'))
    await page.locator('.trigger circle').click()
    expect(await page.evaluate(() => window.autocaptureHarness.eligible())).toBe(true)
    const events = await page.evaluate(() =>
        window.autocaptureHarness.events().filter(({ event }) => event === '$autocapture')
    )
    expect(events).toHaveLength(2)
    for (const event of events) expect(event.properties).not.toHaveProperty('$current_url')
})
