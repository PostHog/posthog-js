import { expect } from '../utils/posthog-playwright-test-base'
import { EventsPage, test } from '../../fixtures'
import { BasePage } from 'fixtures/page'

test.describe('ErrorTracking autocapture', () => {
    async function checkException(events: EventsPage, browserName: string) {
        const exception = await events.waitForEvent('$exception')
        expect(exception.properties.$exception_list[0].stacktrace.type).toEqual('raw')
        expect(exception.properties.$exception_list[0].stacktrace.frames.length).toEqual(1)
        expect(exception.properties.$exception_list[0].stacktrace.frames[0].function).toEqual(
            // turns out firefox and chromium capture different info :/
            browserName === 'chromium' ? 'HTMLButtonElement.onclick' : 'onclick'
        )
    }

    async function checkNoException(page: BasePage, events: EventsPage) {
        await page.close()
        const exceptionCount = events.countByName('$exception')
        expect(exceptionCount).toEqual(0)
    }

    test.use({ url: '/playground/cypress/index.html' })

    test.describe('autocapture', () => {
        test('should capture thrown errors when remote config is enabled', async ({
            posthog,
            page,
            network,
            events,
            browserName,
        }) => {
            await network.mockFlags({
                autocaptureExceptions: true,
            })
            await posthog.init()
            await network.waitForFlags()
            await page.click('[data-cy-button-throws-error]')
            await checkException(events, browserName)
        })

        test('should capture thrown errors when local config is enabled', async ({
            posthog,
            page,
            network,
            events,
            browserName,
        }) => {
            await posthog.init({
                capture_exceptions: true,
            })
            await network.waitForFlags()
            await page.click('[data-cy-button-throws-error]')
            await checkException(events, browserName)
        })

        test('should not capture when remote disabled', async ({ posthog, page, network, events }) => {
            await network.mockFlags({
                autocaptureExceptions: false,
            })
            await posthog.init()
            await network.waitForFlags()
            await page.click('[data-cy-button-throws-error]')
            await checkNoException(page, events)
        })

        test('should not capture when config disabled', async ({ posthog, page, network, events }) => {
            await posthog.init({
                capture_exceptions: false,
            })
            await network.waitForFlags()
            await page.click('[data-cy-button-throws-error]')
            await checkNoException(page, events)
        })

        test('should not capture unhandled promise rejection when config disabled', async ({
            posthog,
            page,
            network,
            events,
        }) => {
            await posthog.init({
                capture_exceptions: false,
            })
            await network.waitForFlags()
            await page.evaluate(() => {
                Promise.reject(new Error('An unknown error occured'))
            })
            await checkNoException(page, events)
        })
    })

    test.describe('unhandled promise rejections', () => {
        test('should capture unhandled promise rejections', async ({ posthog, page, network, events }) => {
            await posthog.init({
                capture_exceptions: true,
            })
            await network.waitForFlags()
            await page.evaluate(() => {
                Promise.reject(new Error('An unknown error occured'))
            })
            const exception = await events.waitForEvent('$exception')
            expect(exception).toBeDefined()
            expect(exception.properties.$exception_list[0].type).toBe('UnhandledRejection')
            expect(exception.properties.$exception_list[0].value).toBe('An unknown error occured')
            expect(exception.properties.$exception_list[0].stacktrace).toMatchObject({ frames: [], type: 'raw' })
        })
    })
})
