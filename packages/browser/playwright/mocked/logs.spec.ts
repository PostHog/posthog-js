/* oxlint-disable no-console */
import { gunzipSync } from 'node:zlib'
import { Page, BrowserContext } from '@playwright/test'
import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

async function logsHarness(page: Page, context: BrowserContext, enabled: boolean, preloadLocallyEnabled = false) {
    const records: any[] = []
    const forwarded: string[] = []
    page.on('console', (message) => {
        if (message.text().startsWith('audit-console-')) forwarded.push(message.text())
    })
    await context.route('**/i/v1/logs*', async (route) => {
        const raw = route.request().postDataBuffer()!
        const body = JSON.parse((raw[0] === 31 && raw[1] === 139 ? gunzipSync(raw) : raw).toString())
        records.push(
            ...body.resourceLogs.flatMap((resource: any) =>
                resource.scopeLogs.flatMap((scope: any) => scope.logRecords)
            )
        )
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await start(
        {
            options: {
                disable_compression: true,
                ...(preloadLocallyEnabled ? { logs: { captureConsoleLogs: true } } : {}),
            },
            flagsResponseOverrides: { logs: { captureConsoleLogs: enabled } },
            runBeforePostHogInit: preloadLocallyEnabled
                ? async (pg) => {
                      await pg.addScriptTag({ url: 'http://localhost:2345/static/logs.js' })
                  }
                : undefined,
        },
        page,
        context
    )
    return { records, forwarded }
}

async function emitConsole(page: Page) {
    await page.evaluate(() => {
        console.log('audit-console-log')
        console.warn('audit-console-warn')
        console.error('audit-console-error')
        ;(window as any).posthog.logs.flushLogs()
    })
}

async function expectConsoleRecords(records: any[]) {
    await expect
        .poll(() =>
            records
                .filter((record) => record.body?.stringValue?.includes('audit-console-'))
                .map((record) => ({ body: record.body.stringValue, severity: record.severityNumber }))
        )
        .toEqual([
            { body: '"audit-console-log"', severity: 9 },
            { body: '"audit-console-warn"', severity: 13 },
            { body: '"audit-console-error"', severity: 17 },
        ])
}

test.describe('logs extension', () => {
    test('should load logs extension when enabled in remote config', async ({ page, context }) => {
        const { records } = await logsHarness(page, context, true)
        await page.waitForFunction(() => !!(window as any).__PosthogExtensions__?.logs?.initializeLogs)
        await emitConsole(page)
        await expectConsoleRecords(records)
    })

    test('should call onRemoteConfig when logs are enabled', async ({ page, context }) => {
        const { records } = await logsHarness(page, context, false)
        await page.evaluate(() =>
            (window as any).posthog.logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: true } } })
        )
        await page.waitForFunction(() => !!(window as any).__PosthogExtensions__?.logs?.initializeLogs)
        await emitConsole(page)
        await expectConsoleRecords(records)
    })

    test('should handle disabled logs in remote config', async ({ page, context }) => {
        const { records, forwarded } = await logsHarness(page, context, false)
        await page.evaluate(() =>
            (window as any).posthog.logs.onRemoteConfig({ ok: true, config: { logs: { captureConsoleLogs: false } } })
        )
        await emitConsole(page)
        await page.evaluate(() => {
            ;(window as any).posthog.captureLog({ body: 'audit-explicit-control', level: 'info' })
            ;(window as any).posthog.logs.flushLogs()
        })
        await expect
            .poll(() => records.some((record) => record.body?.stringValue === 'audit-explicit-control'))
            .toBe(true)
        expect(records.filter((record) => record.body?.stringValue?.includes('audit-console-'))).toEqual([])
        expect(forwarded).toEqual(['audit-console-log', 'audit-console-warn', 'audit-console-error'])
    })

    test('should activate the real preloaded logs extension when locally enabled', async ({ page, context }) => {
        const { records, forwarded } = await logsHarness(page, context, false, true)
        await emitConsole(page)
        await expectConsoleRecords(records)
        expect(forwarded).toEqual(['audit-console-log', 'audit-console-warn', 'audit-console-error'])
    })
})
