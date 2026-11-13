import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
})

test('whole-product acquisition preserves synchronous admission snapshots in a native page', async ({ page }) => {
    const result = await page.evaluate(() => window.acquisitionHarness.snapshot())
    expect(result.before).toBe(false)
    expect(result.same).toBe(true)
    expect(result.admitted).toBe(true)
    expect(result.observed).toEqual(['before_identity_change', '$identify'])
    expect(result.batches.flat()[0]).toMatchObject({
        event: 'before_identity_change',
        distinct_id: result.originalId,
        properties: { phase: 'admitted' },
    })
})

test('visible initial pageview acquires analytics after observers and before readiness', async ({ page }) => {
    const result = await page.evaluate(() => window.acquisitionHarness.pageview())
    expect(result.installed).toBe(true)
    expect(result.observed).toEqual(['$pageview'])
    expect(result.session).toEqual(expect.any(String))
})

test('bare Core and disabled root do not acquire analytics or create a session', async ({ page }) => {
    const result = await page.evaluate(() => window.acquisitionHarness.disabled())
    expect(result).toEqual([
        { installed: false, resolved: false, session: undefined },
        { installed: false, resolved: false, session: undefined },
    ])
})
