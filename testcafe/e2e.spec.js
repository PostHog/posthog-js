import { t } from 'testcafe'
import { retryUntilResults, queryAPI, initPosthog, captureLogger, staticFilesMock } from './helpers'

fixture('posthog.js capture')
    .page('http://localhost:8000/playground/cypress-full/index.html')
    .requestHooks(captureLogger, staticFilesMock)
    .afterEach(async () => {
        const browserLogs = await t.getBrowserConsoleMessages()
        Object.keys(browserLogs).forEach((level) => {
            browserLogs[level].forEach((line) => {
                console.log(`Browser ${level}:`, line)
            })
        })

        // console.debug('Requests to posthog:', JSON.stringify(captureLogger.requests, null, 2))
    })

test('Custom events work and are accessible via /api/event', async (t) => {
    const testSessionId = await initPosthog()
    await t
        .wait(5000)
        .click('[data-cy-custom-event-button]')
        .wait(5000)
        .expect(captureLogger.count(() => true))
        .gte(1)

    // Check no requests failed
    await t.expect(captureLogger.count(({ response }) => response.statusCode !== 200)).eql(0)

    const results = await retryUntilResults(() => queryAPI(testSessionId), 3)

    await t.expect(results.length).eql(3)
    await t.expect(results.filter(({ event }) => event === 'custom-event').length).eql(1)
    await t.expect(results.filter(({ event }) => event === '$pageview').length).eql(1)
    await t.expect(results.filter(({ event }) => event === '$autocapture').length).eql(1)
})

test('Autocaptured events work and are accessible via /api/event', async (t) => {
    const testSessionId = await initPosthog()
    await t
        .wait(5000)
        .click('[data-cy-link-mask-text]')
        .click('[data-cy-button-sensitive-attributes]')
        .wait(5000)
        .expect(captureLogger.count(() => true))
        .gte(2)

    // Check no requests failed
    await t.expect(captureLogger.count(({ response }) => response.statusCode !== 200)).eql(0)

    const results = await retryUntilResults(() => queryAPI(testSessionId), 3)

    const autocapturedEvents = results.filter((e) => e.event === '$autocapture')

    await t.expect(autocapturedEvents.length).eql(2)

    const autocapturedLinkClickEvents = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'a')
    const autocapturedButtonClickEvents = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'button')

    await t.expect(autocapturedButtonClickEvents.length).eql(1)
    await t.expect(autocapturedLinkClickEvents.length).eql(1)

    const autocapturedButtonElement = autocapturedButtonClickEvents[0].elements[0]
    const autocapturedLinkElement = autocapturedLinkClickEvents[0].elements[0]

    // Captures text content if mask_all_text isn't set
    await t.expect(autocapturedLinkElement['text']).eql('Sensitive text!')

    const attrKeys = Object.keys(autocapturedButtonElement.attributes)
    attrKeys.sort()
    await t
        .expect(attrKeys)
        .eql(['attr__class', 'attr__data-cy-button-sensitive-attributes', 'attr__data-sensitive', 'attr__id'])
})

test('Config options change autocapture behavior accordingly', async (t) => {
    const testSessionId = await initPosthog({ mask_all_text: true, mask_all_element_attributes: true })

    await t
        .wait(5000)
        .click('[data-cy-link-mask-text]')
        .click('[data-cy-button-sensitive-attributes]')
        .wait(5000)
        .expect(captureLogger.count(() => true))
        .gte(2)

    // Check no requests failed
    await t.expect(captureLogger.count(({ response }) => response.statusCode !== 200)).eql(0)

    const results = await retryUntilResults(() => queryAPI(testSessionId), 3)

    const autocapturedEvents = results.filter((e) => e.event === '$autocapture')
    await t.expect(autocapturedEvents.length).eql(2)

    const autocapturedLinkElement = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'a')[0].elements[0]
    const autocapturedButtonElement = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'button')[0]
        .elements[0]

    // mask_all_text does not set $el_text
    await t.expect(autocapturedLinkElement['text']).eql(null)

    // mask_all_element_attributes does not capture any attributes at all from all elements
    await t.expect(Object.keys(autocapturedButtonElement.attributes).length).eql(0)
})
