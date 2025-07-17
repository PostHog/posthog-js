import { expect, test } from './fixtures'

test.describe('Exception capture', () => {
    test.use({ url: './playground/cypress/index.html' })
    test.beforeEach(async ({ posthog, events }) => {
        await posthog.init()
        await events.waitForEvent('$pageview')
    })

    test.describe('Exception autocapture disabled', () => {
        test.use({ flagsOverrides: { autocaptureExceptions: false } })
        test('manual exception capture of error', async ({ page, events }) => {
            await page.click('[data-cy-exception-button]')
            const captures = events.all()
            expect(captures.map((c) => c.event)).toEqual(['$pageview', '$autocapture', '$exception'])
            expect(captures[2].event).toEqual('$exception')
            expect(captures[2].properties.extra_prop).toEqual(2)
            expect(captures[2].properties.$exception_source).toBeUndefined()
            expect(captures[2].properties.$exception_personURL).toBeUndefined()
            expect(captures[2].properties.$exception_list[0].value).toEqual('wat even am I')
            expect(captures[2].properties.$exception_list[0].type).toEqual('Error')
        })

        test('manual exception capture of string', async ({ page, events }) => {
            await page.click('[data-cy-exception-string-button]')
            const captures = events.all()
            expect(captures.map((c) => c.event)).toEqual(['$pageview', '$autocapture', '$exception'])
            expect(captures[2].event).toEqual('$exception')
            expect(captures[2].properties.extra_prop).toEqual(2)
            expect(captures[2].properties.$exception_source).toBeUndefined()
            expect(captures[2].properties.$exception_personURL).toBeUndefined()
            expect(captures[2].properties.$exception_list[0].value).toEqual('I am a plain old string')
            expect(captures[2].properties.$exception_list[0].type).toEqual('Error')
        })

        test('should not capture thrown exceptions', async ({ page, events }) => {
            await page.click('[data-cy-button-throws-error]')
            events.expectMatchList(['$pageview', '$autocapture'])
        })
    })

    test.describe('Exception autocapture enabled', () => {
        test.use({ flagsOverrides: { autocaptureExceptions: true } })

        test('adds stacktrace to captured strings', async ({ page, events, browserName }) => {
            await page.click('[data-cy-exception-string-button]')
            const captures = events.all()
            expect(captures.map((c) => c.event)).toEqual(['$pageview', '$autocapture', '$exception'])
            expect(captures[2].event).toEqual('$exception')
            expect(captures[2].properties.$exception_list[0].stacktrace.type).toEqual('raw')
            expect(captures[2].properties.$exception_list[0].stacktrace.frames.length).toEqual(1)
            expect(captures[2].properties.$exception_list[0].stacktrace.frames[0].function).toEqual(
                // turns out firefox and chromium capture different info :/
                browserName === 'chromium' ? 'HTMLButtonElement.onclick' : 'onclick'
            )
        })

        test('should capture thrown exceptions', async ({ page, events }) => {
            await page.click('[data-cy-button-throws-error]')
            events.expectCountMap({
                $pageview: 1,
                $autocapture: 1,
                $exception: 1,
            })
        })
    })
})
