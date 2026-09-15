import { expect, test, type Page } from '@playwright/test'

async function observe(page: Page) {
    const batches: string[][] = []
    const scripts = new Map<string, number>()
    const errors: string[] = []
    let failures = 0
    page.on('request', (request) => {
        if (request.resourceType() === 'script') {
            const path = new URL(request.url()).pathname
            scripts.set(path, (scripts.get(path) ?? 0) + 1)
        }
    })
    page.on('console', (message) => {
        if (message.text().includes('Automatic analytics loading failed')) {
            failures++
        }
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/i/v1/analytics/events', async (route) => {
        const { batch } = route.request().postDataJSON() as { batch: Array<{ event: string; uuid: string }> }
        batches.push(batch.map(({ event }) => event))
        await route.fulfill({
            json: { results: Object.fromEntries(batch.map(({ uuid }) => [uuid, { result: 'ok' }])) },
        })
    })
    return { batches, scripts, errors, failures: () => failures }
}

async function failFirstScript(page: Page, path: string) {
    let attempts = 0
    await page.route(`**${path}`, async (route) => {
        if (++attempts === 1) {
            await route.fulfill({ status: 503, contentType: 'text/javascript', body: '' })
        } else {
            await route.continue()
        }
    })
}

async function assertDelivery(page: Page, observed: Awaited<ReturnType<typeof observe>>) {
    expect(observed.batches).toEqual([['one', 'two']])
    expect(await page.evaluate(() => window.chunkHarness.immediate())).toEqual({
        submitted: 1,
        allPersisted: true,
        error: undefined,
    })
    expect(observed.batches).toEqual([['one', 'two'], ['immediate']])
    expect(await page.evaluate(() => window.chunkHarness.stableAnalytics())).toBe(true)
    await page.evaluate(() => window.chunkHarness.shutdown())
    expect(observed.errors).toEqual([])
}

test('retries a failed Rspack initialization chunk before returning the client', async ({ page }) => {
    const observed = await observe(page)
    const failed = '/chunks/rspack/initialization.js'
    await failFirstScript(page, failed)
    await page.goto('/chunks/rspack')
    await page.evaluate(() => window.chunkHarness.create())
    expect(observed.scripts.get(failed)).toBe(2)
    await page.evaluate(async () => {
        window.chunkHarness.capture('one')
        window.chunkHarness.capture('two')
        await window.chunkHarness.flush()
    })
    await assertDelivery(page, observed)
})

for (const chunk of ['delivery', 'delivery-dependency']) {
    test(`retries a failed Rspack ${chunk} chunk on flush without replacing analytics`, async ({ page }) => {
        const observed = await observe(page)
        const failed = `/chunks/rspack/${chunk}.js`
        await failFirstScript(page, failed)
        await page.goto('/chunks/rspack')
        await page.evaluate(() => window.chunkHarness.create())
        expect(observed.scripts.has(failed)).toBe(false)
        await page.evaluate(() => window.chunkHarness.capture('one'))
        await expect.poll(observed.failures).toBe(1)
        await page.evaluate(() => window.chunkHarness.capture('two'))
        expect(observed.scripts.get(failed)).toBe(1)
        await page.evaluate(() => Promise.all([window.chunkHarness.flush(), window.chunkHarness.flush()]))
        expect(observed.scripts.get(failed)).toBe(2)
        await assertDelivery(page, observed)
    })
}

test('contains a persistent initialization chunk failure after two attempts', async ({ page }) => {
    const observed = await observe(page)
    const failed = '/chunks/rspack/initialization.js'
    await page.route(`**${failed}`, (route) => route.fulfill({ status: 503, contentType: 'text/javascript', body: '' }))
    await page.goto('/chunks/rspack')
    await page.evaluate(() => window.chunkHarness.create())
    expect(observed.scripts.get(failed)).toBe(2)
    await page.evaluate(async () => {
        window.chunkHarness.capture('buffered')
        await window.chunkHarness.flush()
    })
    expect(await page.evaluate(() => window.chunkHarness.immediate())).toEqual({
        submitted: 0,
        allPersisted: false,
        error: 'Immediate analytics delivery is unavailable',
    })
    await page.evaluate(() => window.chunkHarness.shutdown())
    expect(observed.scripts.get(failed)).toBe(2)
    expect(observed.batches).toEqual([])
    expect(observed.errors).toEqual([])
})

test('loads the built public entry through native ESM split chunks', async ({ page }) => {
    const observed = await observe(page)
    await page.goto('/chunks/esm')
    await page.evaluate(async () => {
        await window.chunkHarness.create()
        window.chunkHarness.capture('one')
        window.chunkHarness.capture('two')
        await window.chunkHarness.flush()
    })
    expect([...observed.scripts.keys()].some((path) => path.includes('automatic-analytics-'))).toBe(true)
    expect([...observed.scripts.keys()].some((path) => path.includes('analytics-delivery-'))).toBe(true)
    await assertDelivery(page, observed)
})
