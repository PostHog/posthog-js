import { expect, test } from '@playwright/test'
import type { OtlpLogsPayload } from '@posthog/types'

for (const remote of [false, true]) {
    test(`logs capture console with ${remote ? 'remote' : 'local'} permission and flush separate scopes on shutdown`, async ({
        page,
    }) => {
        const requests: OtlpLogsPayload[] = []
        await page.route('**/i/v1/logs?token=ph_browser_logs', async (route) => {
            requests.push(route.request().postDataJSON() as OtlpLogsPayload)
            await route.fulfill({ status: 200, body: '{}' })
        })
        await page.goto('/')
        await page.evaluate((remote) => window.logsHarness.initialize(remote), remote)
        await page.evaluate(() => {
            window.logsHarness.console('console record')
            window.logsHarness.capture('programmatic record')
        })
        await page.evaluate(() => window.logsHarness.shutdown())
        expect(requests).toHaveLength(2)
        const scopes = requests.flatMap((request) => request.resourceLogs.flatMap((resource) => resource.scopeLogs))
        expect(scopes.map((scope) => scope.scope.name)).toContain('console')
        expect(scopes.flatMap((scope) => scope.logRecords.map((record) => record.body))).toEqual(
            expect.arrayContaining([{ stringValue: '"console record"' }, { stringValue: 'programmatic record' }])
        )
        expect(await page.evaluate(() => window.logsHarness.restored())).toBe(true)
        await page.evaluate(() => window.logsHarness.console('after shutdown'))
        expect(requests).toHaveLength(2)
    })
}

test('pagehide hands admitted logs to Beacon while shutdown Fetch is pending', async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(() => window.logsHarness.pagehideDuringShutdown())
    expect(result.fetches).toBe(1)
    expect(result.aborted).toBe(true)
    const payload = JSON.parse(result.beacon) as OtlpLogsPayload
    expect(
        payload.resourceLogs.flatMap((resource) =>
            resource.scopeLogs.flatMap((scope) => scope.logRecords.map((r) => r.body))
        )
    ).toEqual([{ stringValue: 'pending navigation' }])
})

test('cross-tab consent denial purges queued logs before a later grant', async ({ context }) => {
    const requests: unknown[] = []
    await context.route('**/i/v1/logs?token=ph_browser_logs', async (route) => {
        requests.push(route.request().postDataJSON())
        await route.fulfill({ status: 200, body: '{}' })
    })
    const first = await context.newPage()
    const second = await context.newPage()
    await first.goto('/')
    await second.goto('/')
    await first.evaluate(() => window.logsHarness.initialize(false))
    await second.evaluate(() => window.logsHarness.initialize(false))
    await second.evaluate(() => {
        window.logsHarness.capture('queued')
        window.logsHarness.console('queued console')
    })
    await first.evaluate(() => window.logsHarness.optOut())
    await second.waitForTimeout(50)
    await first.evaluate(() => window.logsHarness.optIn())
    await second.waitForTimeout(50)
    await second.evaluate(() => window.logsHarness.flush())
    expect(requests).toHaveLength(0)
    await second.evaluate(() => {
        window.logsHarness.capture('fresh')
    })
    await second.evaluate(() => window.logsHarness.shutdown())
    expect(requests).toHaveLength(1)
})
