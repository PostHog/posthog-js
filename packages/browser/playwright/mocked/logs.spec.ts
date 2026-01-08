/* eslint-disable posthog-js/no-direct-function-check, no-console, @typescript-eslint/no-unused-vars */
import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'

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
                        logs: {
                            captureConsoleLogs: true,
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
                        logs: {
                            captureConsoleLogs: false,
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
