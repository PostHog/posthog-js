/* eslint-disable posthog-js/no-direct-function-check, no-console */
import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

test('current logs bundle captures through its host array bundle', async ({ page, context }) => {
    await start(
        {
            options: {
                api_host: 'http://localhost:2345',
                debug: true,
                logs: { captureConsoleLogs: true },
            },
        },
        page,
        context
    )

    await page.evaluate(() => {
        const logs = (window as any).posthog.logs
        const config = { logs: { captureConsoleLogs: true } }
        logs.onRemoteConfig(config)
        logs.onRemoteConfig({ ok: true, config })
    })

    await expect.poll(() => page.evaluate(() => !!(console.warn as any).__rrweb_original__)).toBe(true)

    const result = await page.evaluate(() => {
        const logs = (window as any).posthog.logs
        const usesClientHost = typeof logs.setup === 'function'
        const calls: Array<{ method: string; args: any[] }> = []

        for (const method of ['le', 'captureConsoleLog']) {
            const original = logs[method]
            if (typeof original === 'function') {
                logs[method] = (...args: any[]) => {
                    calls.push({ method, args })
                    return original.apply(logs, args)
                }
            }
        }

        console.warn('posthog-logs-version-skew-smoke')

        return {
            captured: calls.find(
                ({ args }) => args[0]?.level === 'warn' && args[0]?.body?.includes('posthog-logs-version-skew-smoke')
            ),
            usesClientHost,
        }
    })

    expect(result.captured?.method).toBe(result.usesClientHost ? 'captureConsoleLog' : 'le')
})
