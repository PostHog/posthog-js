import { expect } from '../utils/posthog-playwright-test-base'
import { test } from '../../fixtures'

test.describe('ErrorTracking chunkIds', () => {
    test.use({
        url: '/playground/cypress/index.html',
    })

    test('chunk ids are added to frames when present', async ({ events, page, posthog }) => {
        await posthog.init()
        const chunkId = '1234'
        await page.route(`https://errortracking.com/script.js`, async (route) => {
            await route.fulfill({
                headers: { loaded: 'using relative path by playwright' },
                contentType: 'application/javascript',
                body: `
                !function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]="${chunkId}")}catch(e){}}();
                const error = new Error('this is an error')
                window.posthog.captureException(error)
                `,
            })
        })
        await page.addScriptTag({
            type: 'module',
            url: 'https://errortracking.com/script.js',
        })
        const exception = await events.waitForEvent('$exception')
        expect(exception.properties.$exception_list).toHaveLength(1)
        expect(exception.properties.$exception_list[0].stacktrace.frames).toHaveLength(1)
        expect(exception.properties.$exception_list[0].stacktrace.frames[0].chunk_id).toEqual(chunkId)
    })
})
