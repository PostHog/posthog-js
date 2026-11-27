import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
    await page.goto('/')
})

test('root capture preserves synchronous admission snapshots in a native page', async ({ page }) => {
    const result = await page.evaluate(() => window.rootHarness.snapshot())
    expect(result.admitted).toBe(true)
    expect(result.observed).toEqual(['before_identity_change', '$identify'])
    expect(result.batches.flat()[0]).toMatchObject({
        event: 'before_identity_change',
        distinct_id: result.originalId,
        properties: { phase: 'admitted' },
    })
})

test('visible initial pageview reaches observers installed during initialization', async ({ page }) => {
    const result = await page.evaluate(() => window.rootHarness.pageview())
    expect(result.observed).toEqual(['$pageview'])
    expect(result.session).toEqual(expect.any(String))
})

test('core and root without capture install no products and create no session', async ({ page }) => {
    const result = await page.evaluate(() => window.rootHarness.idle())
    expect(result).toEqual([
        { products: [], session: undefined },
        { products: [], session: undefined },
    ])
})
