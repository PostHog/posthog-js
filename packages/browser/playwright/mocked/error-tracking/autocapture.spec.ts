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
        test('should capture with error', async ({ posthog, page, network, events, browserName }) => {
            await posthog.init({
                capture_exceptions: true,
            })
            await network.waitForFlags()
            await page.evaluate(() => {
                class CustomError extends Error {
                    constructor(message: string) {
                        super(message)
                        this.name = 'CustomError'
                    }
                }
                Promise.reject(new CustomError('An unknown error occured'))
            })
            const event = await events.waitForEvent('$exception')
            const first_exception = event.properties.$exception_list[0]
            expect(first_exception.type).toBe('CustomError')
            expect(first_exception.value).toBe('An unknown error occured')
            expect(first_exception.mechanism.handled).toBe(false)
            const frames = first_exception.stacktrace.frames
            if (browserName === 'chromium') {
                expect(frames).toHaveLength(3)
            } else {
                expect(frames).toHaveLength(0)
            }
        })

        test('should capture with string', async ({ posthog, page, network, events }) => {
            await posthog.init({
                capture_exceptions: true,
            })
            await network.waitForFlags()
            await page.evaluate(() => {
                Promise.reject('An unknown error occured')
            })
            const exception = await events.waitForEvent('$exception')
            expect(exception).toBeDefined()
            expect(exception.properties.$exception_list[0].type).toBe('UnhandledRejection')
            expect(exception.properties.$exception_list[0].value).toBe(
                'Non-Error promise rejection captured with value: An unknown error occured'
            )
            const stacktrace = exception.properties.$exception_list[0].stacktrace
            expect(stacktrace).toBeUndefined()
        })
    })

    test.describe('unhandled errors', () => {
        test('should capture ReferenceError', async ({ posthog, network, page, events, browserName }) => {
            await posthog.init({
                capture_exceptions: true,
            })
            await network.waitForFlags()
            await page.addScriptTag({
                content: 'gibberish',
                type: 'module',
            })
            const event = await events.waitForEvent('$exception')
            const first_exception = event.properties.$exception_list[0]
            expect(first_exception.type).toBe('ReferenceError')
            switch (browserName) {
                case 'webkit':
                    expect(first_exception.value).toBe("Can't find variable: gibberish")
                    break
                case 'chromium':
                case 'firefox':
                    expect(first_exception.value).toBe('gibberish is not defined')
                    break
            }

            expect(first_exception.mechanism.handled).toBe(false)
            const frames = first_exception.stacktrace.frames
            expect(frames).toHaveLength(1)
        })

        test('should capture SyntaxError', async ({ posthog, network, page, events, browserName }) => {
            await posthog.init({
                capture_exceptions: true,
            })
            await network.waitForFlags()
            await page.addScriptTag({
                content: "let toto = 'asdsds; ",
                type: 'module',
            })
            const event = await events.waitForEvent('$exception')
            const first_exception = event.properties.$exception_list[0]
            expect(first_exception.type).toBe('SyntaxError')
            expect(first_exception.mechanism.handled).toBe(false)
            const frames = first_exception.stacktrace?.frames || []
            switch (browserName) {
                case 'chromium':
                    expect(first_exception.value).toBe(
                        "Failed to execute 'appendChild' on 'Node': Invalid or unexpected token"
                    )
                    expect(frames).toHaveLength(3)
                    break
                case 'firefox':
                    expect(first_exception.value).toBe("'' literal not terminated before end of script")
                    expect(frames).toHaveLength(5)
                    break
                case 'webkit':
                    expect(first_exception.value).toBe('Unexpected EOF')
                    expect(frames).toHaveLength(0)
                    break
            }
        })

        test('should capture console errors', async ({ posthog, network, page, events }) => {
            await posthog.init({
                capture_exceptions: {
                    capture_console_errors: true,
                    capture_unhandled_errors: false,
                    capture_unhandled_rejections: false,
                },
            })
            await network.waitForFlags()
            await page.evaluate(() => {
                //eslint-disable-next-line no-console
                console.error('This error shoud be captured with a stack')
            })

            const event = await events.waitForEvent('$exception')
            const first_exception = event.properties.$exception_list[0]
            expect(first_exception.type).toBe('Error')
            expect(first_exception.value).toBe('This error shoud be captured with a stack')
            expect(first_exception.stacktrace).toBeDefined()
            // Numbers of frames varies depending on browser
            expect(first_exception.stacktrace.frames.length).toBeGreaterThan(3)
            expect(first_exception.mechanism.handled).toBe(false)
        })
    })
})
