import { t } from 'testcafe'
import { retryUntilResults, queryAPI, initPosthog, captureLogger, staticFilesMock, clearEvents } from './helpers'

fixture('posthog.js capture')
    .page('http://localhost:8000/playground/cypress/index.html')
    .requestHooks(captureLogger, staticFilesMock)
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

test('Custom events work and are accessible via /api/event', async (t) => {
    await initPosthog()
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

test('Autocaptured events work and are accessible via /api/event', async (t) => {
    await initPosthog()
    await t
        .click('[data-cy-link-mask-text]')
        .click('[data-cy-button-sensitive-attributes]')
        .wait(5000)
        .expect(captureLogger.count(() => true))
        .gte(2)

    // Check no requests failed
    await t.expect(captureLogger.count(({ response }) => response.statusCode !== 200)).eql(0)

    const results = await retryUntilResults(queryAPI)

    const autocapturedEvents = results.filter((e) => e.event === '$autocapture')
    await t.expect(autocapturedEvents.length).eql(2)

    const autocapturedButtonClick = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'a')
    const autocapturedLinkClick = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'button')

    await t.expect(autocapturedButtonClick.length).eql(1)
    await t.expect(autocapturedLinkClick.length).eql(1)
})

test('Config options change autocapture behavior accordingly', async (t) => {
    await initPosthog({ mask_all_text: true, mask_all_element_attributes: true })
    await t
        .click('[data-cy-link-mask-text]')
        .click('[data-cy-button-sensitive-attributes]')
        .wait(5000)
        .expect(captureLogger.count(() => true))
        .gte(2)

    // Check no requests failed
    await t.expect(captureLogger.count(({ response }) => response.statusCode !== 200)).eql(0)

    const results = await retryUntilResults(queryAPI)

    const autocapturedEvents = results.filter((e) => e.event === '$autocapture')
    await t.expect(autocapturedEvents.length).eql(2)

    const autocapturedButtonElement = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'a')[0].elements[0]
    const autocapturedLinkElement = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'button')[0].elements[0]

    // mask_all_text does not set $el_text
    await t.expect('$el_text' in autocapturedLinkElement).eql(false)

    // mask_all_element_attributes does not capture any attributes at all from all elements
    await t.expect(Object.keys(autocapturedButtonElement.attributes).length).eql(0)
})
