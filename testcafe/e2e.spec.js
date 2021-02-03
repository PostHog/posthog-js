import { t } from 'testcafe'
import { retryUntilResults, queryAPI, initPosthog, captureLogger, staticFilesMock, clearEvents } from './helpers'

fixture('posthog.js capture')
    .page('http://localhost:8000/playground/cypress/index.html')
    .requestHooks(captureLogger, staticFilesMock)
    .beforeEach(() => initPosthog())
    .afterEach(async () => {
        await clearEvents()

        const browserLogs = await t.getBrowserConsoleMessages()
        Object.keys(browserLogs).forEach((level) => {
            browserLogs[level].forEach((line) => {
                console.log(`Browser ${level}:`, line)
            })
        })

        console.debug('Requests to posthog:', JSON.stringify(captureLogger.requests, null, 2))
    })

test('Captured events are accessible via /api/event', async (t) => {
    await t
        .click('[data-cy-custom-event-button]')
        .wait(5000)
        .expect(captureLogger.count(() => true))
        .gte(1)

    // Check no requests failed
    await t.expect(captureLogger.count(({ response }) => response.statusCode !== 200)).eql(0)

    const results = await retryUntilResults(queryAPI)

    await t.expect(results.length).gte(2)
    await t.expect(results.filter(({ event }) => event === 'custom-event').length).gte(1)
    await t.expect(results.filter(({ event }) => event === '$pageview').length).gte(1)
})
