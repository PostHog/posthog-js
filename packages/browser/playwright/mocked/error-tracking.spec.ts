import { expect, test } from './utils/posthog-playwright-test-base'
import { start } from './utils/setup'
import { pollUntilEventCaptured } from './utils/event-capture-utils'

test.describe('Exception capture', () => {
    test.describe('Exception autocapture enabled', () => {
        test.beforeEach(async ({ page, context }) => {
            await start(
                { flagsResponseOverrides: { autocaptureExceptions: false }, url: './playground/cypress/index.html' },
                page,
                context
            )
        })

        test('manual exception capture of error', async ({ page }) => {
            await page.click('[data-cy-exception-button]')

            await pollUntilEventCaptured(page, '$exception')

            const captures = await page.capturedEvents()
            expect(captures.map((c) => c.event)).toEqual(['$pageview', '$autocapture', '$exception'])
            expect(captures[2].event).toEqual('$exception')
            expect(captures[2].properties.extra_prop).toEqual(2)
            expect(captures[2].properties.$exception_source).toBeUndefined()
            expect(captures[2].properties.$exception_personURL).toBeUndefined()
            expect(captures[2].properties.$exception_list[0].value).toEqual('wat even am I')
            expect(captures[2].properties.$exception_list[0].type).toEqual('Error')
        })

        test('manual exception capture of string', async ({ page }) => {
            await page.click('[data-cy-exception-string-button]')

            await pollUntilEventCaptured(page, '$exception')

            const captures = await page.capturedEvents()
            expect(captures.map((c) => c.event)).toEqual(['$pageview', '$autocapture', '$exception'])
            expect(captures[2].event).toEqual('$exception')
            expect(captures[2].properties.extra_prop).toEqual(2)
            expect(captures[2].properties.$exception_source).toBeUndefined()
            expect(captures[2].properties.$exception_personURL).toBeUndefined()
            expect(captures[2].properties.$exception_list[0].value).toEqual('I am a plain old string')
            expect(captures[2].properties.$exception_list[0].type).toEqual('Error')
        })
    })

    test.describe('Exception autocapture enabled', () => {
        test.beforeEach(async ({ page, context }) => {
            await page.waitingForNetworkCausedBy({
                urlPatternsToWaitFor: ['**/exception-autocapture.js*'],
                action: async () => {
                    await start(
                        {
                            flagsResponseOverrides: { autocaptureExceptions: true },
                            url: './playground/cypress/index.html',
                        },
                        page,
                        context
                    )
                },
            })
        })

        test('adds stacktrace to captured strings', async ({ page, browserName }) => {
            await page.click('[data-cy-exception-string-button]')

            await pollUntilEventCaptured(page, '$exception')

            const captures = await page.capturedEvents()
            expect(captures.map((c) => c.event)).toEqual(['$pageview', '$autocapture', '$exception'])
            expect(captures[2].event).toEqual('$exception')
            expect(captures[2].properties.$exception_list[0].stacktrace.type).toEqual('raw')
            expect(captures[2].properties.$exception_list[0].stacktrace.frames.length).toEqual(1)
            expect(captures[2].properties.$exception_list[0].stacktrace.frames[0].function).toEqual(
                // turns out firefox and chromium capture different info :/
                browserName === 'chromium' ? 'HTMLButtonElement.onclick' : 'onclick'
            )
        })
    })
})
