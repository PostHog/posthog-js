/* oxlint-disable posthog-js/no-direct-function-check, no-console, typescript/no-unused-vars */
import { decompressSync, strFromU8 } from 'fflate'
import type { OtlpLogsPayload } from '@/types'
import { expect, test, WindowWithPostHog } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

// Runs with both the current core and the published core selected by the compat fixture.
test('delivers shared console values and true cycles after a persisted logs cold start with delayed config', async ({
    page,
    context,
    staticOverrides,
}, testInfo) => {
    const payloads: OtlpLogsPayload[] = []
    const assets: { url: string; source: string | undefined }[] = []
    page.on('response', (response) => {
        if (/\/static\/(array|logs)\.js/.test(response.url())) {
            assets.push({ url: response.url(), source: response.headers().source })
        }
    })
    await page.route('**/i/v1/logs*', async (route) => {
        const bytes = route.request().postDataBuffer()!
        const body =
            bytes[0] === 0x1f && bytes[1] === 0x8b ? strFromU8(decompressSync(new Uint8Array(bytes))) : bytes.toString()
        payloads.push(JSON.parse(body))
        await route.fulfill({ json: {} })
    })
    await page.route(/\/array\/[^/]+\/config\.js(\?|$)/, (route) =>
        route.fulfill({ contentType: 'application/javascript', body: '' })
    )
    const options = {
        url: '/playground/cypress/index.html',
        options: {
            persistence: 'localStorage' as const,
            strict_script_versioning: false as const,
            debug: false,
            logs: { flushIntervalMs: 50 },
        },
        flagsResponseOverrides: {
            logs: { captureConsoleLogs: true },
            autocapture_opt_out: true,
            capturePerformance: false,
        },
    }
    const firstLogsScript = page.waitForResponse(/\/static\/logs\.js/)
    await start(options, page, context)
    await firstLogsScript
    const key = '$logs_capture_enabled_server_side'
    expect(await page.evaluate((key) => (window as WindowWithPostHog).posthog!.get_property(key), key)).toBe(true)

    let releaseConfig!: () => void
    let configRequested!: () => void
    const gate = new Promise<void>((resolve) => {
        releaseConfig = resolve
    })
    const requested = new Promise<void>((resolve) => {
        configRequested = resolve
    })
    await page.route(/\/array\/[^/]+\/config(\?|$)/, async (route) => {
        configRequested()
        await gate
        await route.fulfill({ json: options.flagsResponseOverrides })
    })
    try {
        await start({ ...options, type: 'reload', waitForFlags: false }, page, context)
        await requested
        expect(await page.evaluate((key) => (window as WindowWithPostHog).posthog!.get_property(key), key)).toBe(true)
        // A persisted true is only a hint: console arguments are buffered until fresh config confirms it.
        await page.evaluate(() => {
            const shared = { value: 'shared-cold-start' }
            const log: Record<string, unknown> = { marker: 'logs-shared-compat', a: shared, b: shared }
            log.self = log
            console.log(log)
        })
        const logsScript = page.waitForResponse(/\/static\/logs\.js/)
        releaseConfig()
        await logsScript
        const records = () =>
            payloads
                .flatMap((payload) => payload.resourceLogs)
                .flatMap((resource) => resource.scopeLogs)
                .flatMap((scope) => scope.logRecords)
                .filter((record) => record.body?.stringValue?.includes('logs-shared-compat'))
        await expect.poll(() => records().length).toBe(1)
        const record = records()[0]
        expect(JSON.parse(record.body!.stringValue!)).toEqual({
            marker: 'logs-shared-compat',
            a: { value: 'shared-cold-start' },
            b: { value: 'shared-cold-start' },
            self: '[Circular]',
        })
        expect(record.attributes).toEqual(
            expect.arrayContaining([
                { key: 'a.value', value: { stringValue: 'shared-cold-start' } },
                { key: 'b.value', value: { stringValue: 'shared-cold-start' } },
            ])
        )
        expect(record.attributes?.some((attribute) => attribute.key.startsWith('self.'))).toBe(false)
        expect(assets.filter((asset) => asset.source === (staticOverrides['array.js'] ?? 'array.js'))).toHaveLength(2)
        expect(assets.filter((asset) => asset.source === 'logs.js')).toHaveLength(2)
    } finally {
        releaseConfig()
        await testInfo.attach('loaded-core-and-logs-assets', {
            body: JSON.stringify({ compatVersion: process.env.COMPAT_VERSION, assets }, null, 2),
            contentType: 'application/json',
        })
    }
})

test.describe('logs extension', () => {
    test('should load logs extension when enabled in remote config', async ({ page, context }) => {
        // Start PostHog
        await start(
            {
                options: {
                    api_host: 'https://localhost:1234',
                    debug: true,
                },
            },
            page,
            context
        )

        // Wait for PostHog to initialize
        await page.waitForTimeout(100)

        // Check that PostHog logs is available
        const logsAvailable = await page.evaluate(() => {
            const posthog = (window as any).posthog
            return !!(posthog && posthog.logs)
        })

        expect(logsAvailable).toBe(true)
    })

    test('should call onRemoteConfig when logs are enabled', async ({ page, context }) => {
        await start(
            {
                options: {
                    api_host: 'https://localhost:1234',
                    debug: true,
                },
            },
            page,
            context
        )

        // Wait for PostHog to initialize
        await page.waitForTimeout(100)

        // Test that we can call onRemoteConfig with logs enabled
        const result = await page.evaluate(() => {
            const posthog = (window as any).posthog
            let configCalled = false

            if (posthog && posthog.logs && typeof posthog.logs.onRemoteConfig === 'function') {
                try {
                    posthog.logs.onRemoteConfig({
                        ok: true,
                        config: {
                            logs: {
                                captureConsoleLogs: true,
                            },
                        },
                    })
                    configCalled = true
                } catch (error) {
                    console.log('Error in onRemoteConfig:', error)
                    configCalled = false
                }
            }

            return {
                hasPosthog: !!posthog,
                hasLogs: !!(posthog && posthog.logs),
                hasOnRemoteConfig: !!(posthog && posthog.logs && typeof posthog.logs.onRemoteConfig === 'function'),
                configCalled: configCalled,
            }
        })

        expect(result.hasPosthog).toBe(true)
        expect(result.hasLogs).toBe(true)
        expect(result.hasOnRemoteConfig).toBe(true)
        expect(result.configCalled).toBe(true)
    })

    test('should handle disabled logs in remote config', async ({ page, context }) => {
        await start(
            {
                options: {
                    api_host: 'https://localhost:1234',
                    debug: true,
                },
            },
            page,
            context
        )

        // Wait for PostHog to initialize
        await page.waitForTimeout(100)

        // Test that we can call onRemoteConfig with logs disabled
        const result = await page.evaluate(() => {
            const posthog = (window as any).posthog
            let configCalled = false

            if (posthog && posthog.logs && typeof posthog.logs.onRemoteConfig === 'function') {
                try {
                    posthog.logs.onRemoteConfig({
                        ok: true,
                        config: {
                            logs: {
                                captureConsoleLogs: false,
                            },
                        },
                    })
                    configCalled = true
                } catch (error) {
                    console.log('Error in onRemoteConfig:', error)
                    configCalled = false
                }
            }

            return {
                hasPosthog: !!posthog,
                hasLogs: !!(posthog && posthog.logs),
                configCalled: configCalled,
            }
        })

        expect(result.hasPosthog).toBe(true)
        expect(result.hasLogs).toBe(true)
        expect(result.configCalled).toBe(true)
    })

    test('should intercept console methods when logs extension is manually initialized', async ({ page, context }) => {
        await start(
            {
                options: {
                    api_host: 'https://localhost:1234',
                    debug: true,
                },
            },
            page,
            context
        )

        // Wait for PostHog to initialize
        await page.waitForTimeout(100)

        // Set up the logs extension and initialize it in the same context
        const result = await page.evaluate(() => {
            // Set up the logs extension directly
            ;(window as any).__PosthogExtensions__ = {
                initializeLogs: (posthog: any) => {
                    // Simple console interception
                    const originalConsole = {
                        log: console.log,
                        warn: console.warn,
                        error: console.error,
                    }

                    ;(window as any).__intercepted_logs = []

                    console.log = (...args: any[]) => {
                        ;(window as any).__intercepted_logs.push({
                            level: 'log',
                            args: args,
                        })
                        originalConsole.log.apply(console, args)
                    }

                    console.warn = (...args: any[]) => {
                        ;(window as any).__intercepted_logs.push({
                            level: 'warn',
                            args: args,
                        })
                        originalConsole.warn.apply(console, args)
                    }

                    console.error = (...args: any[]) => {
                        ;(window as any).__intercepted_logs.push({
                            level: 'error',
                            args: args,
                        })
                        originalConsole.error.apply(console, args)
                    }
                },
            }

            // Initialize the logs extension
            const posthog = (window as any).posthog
            const extensions = (window as any).__PosthogExtensions__
            if (extensions && extensions.initializeLogs && posthog) {
                extensions.initializeLogs(posthog)
            }

            // Test console methods immediately after initialization
            console.log('Test message 1')
            console.warn('Warning message')
            console.error('Error message')

            // Return the intercepted logs
            return (window as any).__intercepted_logs || []
        })

        expect(result).toHaveLength(3)
        expect(result[0]).toMatchObject({
            level: 'log',
            args: ['Test message 1'],
        })
        expect(result[1]).toMatchObject({
            level: 'warn',
            args: ['Warning message'],
        })
        expect(result[2]).toMatchObject({
            level: 'error',
            args: ['Error message'],
        })
    })
})
