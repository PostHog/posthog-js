import { expect, test } from '@playwright/test'

test('immediate capture waits for a terminal Capture V1 persistence result', async ({ page }) => {
    await page.goto('/')

    const summary = await page.evaluate(() => window.consentHarness.captureImmediate('immediate_browser_test'))

    expect(summary).toMatchObject({
        submitted: 1,
        notPersisted: 0,
        allPersisted: true,
    })
    expect(Object.values(summary.results)).toEqual([{ result: 'ok' }])
    expect(await page.evaluate(() => window.consentHarness.requests())).toBe(1)
})
