/* eslint-disable posthog-js/no-direct-function-check, no-console */
import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

const historicalCaptureMethod = (version: string): string | undefined => {
    const [, , minorText, patchText] = /^(\d+)\.(\d+)\.(\d+)/.exec(version) || []
    const minor = Number(minorText)
    const patch = Number(patchText)
    if ((minor >= 392 && minor < 410) || (minor === 410 && patch <= 4)) {
        return 'le'
    }
    if (minor === 410 && patch <= 10) {
        return 'de'
    }
    if ((minor >= 411 && minor < 418) || (minor === 418 && patch <= 3)) {
        return 'he'
    }
    if (minor === 418 && patch <= 10) {
        return 'ui'
    }
    if (minor === 418 && patch <= 14) {
        return 'ci'
    }
    if ((minor === 418 && patch <= 17) || (minor === 419 && patch <= 2)) {
        return 'vi'
    }
    return undefined
}

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

    // Spy before the call and poll for it, rather than probing a console wrapper for a
    // marker: the SDK's pre-load recorder marks its wrapper exactly as the lazy bundle
    // does, so the marker cannot tell which of the two is installed.
    await page.evaluate(() => {
        const logs = (window as any).posthog.logs
        const calls: Array<{ method: string; args: any[] }> = []
        ;(window as any).__skewCalls = calls

        for (const method of ['le', 'de', 'he', 'ui', 'ci', 'vi', 'captureConsoleLog', 'captureBufferedConsoleLog']) {
            const original = logs[method]
            if (typeof original === 'function') {
                logs[method] = (...args: any[]) => {
                    calls.push({ method, args })
                    return original.apply(logs, args)
                }
            }
        }

        console.warn('posthog-logs-version-skew-smoke')
    })

    const findCaptured = () =>
        page.evaluate(
            () =>
                ((window as any).__skewCalls as Array<{ method: string; args: any[] }>).find(
                    ({ args }) =>
                        args[0]?.level === 'warn' && args[0]?.body?.includes('posthog-logs-version-skew-smoke')
                ) ?? null
        )
    await expect.poll(findCaptured).not.toBeNull()

    const result = await page.evaluate(() => ({
        usesClientHost: typeof (window as any).posthog.logs.setup === 'function',
        version: (window as any).posthog.version,
    }))
    const captured = await findCaptured()

    // A call the recorder buffered is replayed through `captureBufferedConsoleLog`, which
    // only an SDK new enough to have the recorder exposes; every other build has to land
    // on the capture method its own vintage of the chunk calls by name.
    const liveMethod = result.usesClientHost ? 'captureConsoleLog' : historicalCaptureMethod(result.version)
    expect(captured?.method).toBe(
        result.usesClientHost && captured?.method === 'captureBufferedConsoleLog'
            ? 'captureBufferedConsoleLog'
            : liveMethod
    )
})
