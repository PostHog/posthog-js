import { t } from 'testcafe'
import { retryUntilResults, queryAPI, initPosthog, captureLogger, clearEvents } from './helpers'

fixture('posthog.js capture')
    .page('http://localhost:8080/playground/cypress/index.html')
    .requestHooks(captureLogger)
    .beforeEach(() => initPosthog())
    .afterEach(async () => {
        await clearEvents()

        console.debug('Browser logs:', await t.getBrowserConsoleMessages())
        console.debug('Requests to posthog:', captureLogger.requests)
    })

test('Captured events are accessible via /api/event', async (t) => {
    await t
        .click('[data-cy-custom-event-button]')
        .wait(5000)
        .expect(captureLogger.count(() => true))
        .gte(1)

    // Check no requests failed
    await t.expect(captureLogger.count(({ response }) => response.statusCode !== 200)).eql(0)
    console.log(captureLogger.requests)

    const results = await retryUntilResults(queryAPI)

    console.log(results)

    await t.expect(results.length).gte(2)
    await t.expect(results.filter(({ event }) => event === 'custom-event').length).gte(1)
    await t.expect(results.filter(({ event }) => event === '$pageview').length).gte(1)
})
