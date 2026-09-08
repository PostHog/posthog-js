import { expect } from '../utils/posthog-playwright-test-base'
import { test } from '../../fixtures'

test.use({ url: '/playground/cypress/index.html' })

test('captures exceptions with the posthog-js 1.140.1 core', async ({ posthog, page, network }) => {
    await network.mockFlags({ autocaptureExceptions: true })
    await posthog.init()

    await page.waitForFunction(() => {
        const win = window as any
        return (
            win.extendPostHogWithExceptionAutoCapture &&
            win.extendPostHogWithExceptionAutoCapture === win.extendPostHogWithExceptionAutocapture &&
            win.onerror?.__POSTHOG_INSTRUMENTED__ === true
        )
    })

    await page.evaluate(() => {
        const win = window as any
        const originalCapture = win.posthog.capture
        win.__legacyCapturedEvents = []
        win.posthog.capture = function (event: string, ...args: any[]) {
            win.__legacyCapturedEvents.push({ event, options: args[1] })
            return originalCapture.call(this, event, ...args)
        }
    })

    await page.click('[data-cy-button-throws-error]')

    await expect
        .poll(() =>
            page.evaluate(() =>
                (window as any).__legacyCapturedEvents.find(({ event }: { event: string }) => event === '$exception')
            )
        )
        .toEqual({
            event: '$exception',
            options: expect.objectContaining({ _noHeatmaps: true }),
        })
})

test('does not throw when exception property building fails with the legacy core', async ({
    posthog,
    page,
    network,
}) => {
    await network.mockFlags({ autocaptureExceptions: true })
    await posthog.init()

    await page.waitForFunction(() => (window as any).onerror?.__POSTHOG_INSTRUMENTED__ === true)

    const result = await page.evaluate(() => {
        const error = new Error('legacy error')
        Object.defineProperty(error, 'message', {
            get() {
                throw new TypeError('property building failed')
            },
        })

        return window.onerror?.('message', 'source', 1, 2, error)
    })

    expect(result).toBe(false)
})

test('respects legacy exception exclusion rules', async ({ posthog, page, network }) => {
    await network.mockFlags({
        autocaptureExceptions: {
            errors_to_ignore: ['^This is an error$'],
        },
    })
    await posthog.init()

    await page.waitForFunction(() => (window as any).onerror?.__POSTHOG_INSTRUMENTED__ === true)

    await page.evaluate(() => {
        const win = window as any
        const originalCapture = win.posthog.capture
        win.__legacyCapturedEvents = []
        win.posthog.capture = function (event: string, ...args: any[]) {
            win.__legacyCapturedEvents.push(event)
            return originalCapture.call(this, event, ...args)
        }
    })

    await page.click('[data-cy-button-throws-error]')

    expect(await page.evaluate(() => (window as any).__legacyCapturedEvents)).not.toContain('$exception')
})
