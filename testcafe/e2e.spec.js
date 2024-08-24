import { t } from 'testcafe'
import {
    captureLogger,
    capturesMap,
    initPosthog,
    isLoaded,
    queryAPI,
    retryUntilResults,
    staticFilesMock,
    writeResultsJsonFile,
} from './helpers'
import { expect } from 'expect'

// eslint-disable-next-line no-undef
fixture('posthog.js capture')
    .page('http://localhost:8000/playground/cypress-full/index.html')
    .requestHooks(captureLogger, staticFilesMock)
    .afterEach(async () => {
        const browserLogs = await t.getBrowserConsoleMessages()
        Object.keys(browserLogs).forEach((level) => {
            browserLogs[level].forEach((line) => {
                // eslint-disable-next-line no-console
                console.log(`Browser ${level}:`, line)
            })
        })

        // console.debug('Requests to posthog:', JSON.stringify(captureLogger.requests, null, 2))
    })

test('Custom events work and are accessible via /api/event', async (t) => {
    const testSessionId = await initPosthog(t.testRun.test.name)
    await t
        .wait(5000)
        .expect(isLoaded())
        .ok()
        .click('[data-cy-custom-event-button]')
        .wait(10000)
        .expect(capturesMap())
        .contains({
            $pageview: 1,
            $autocapture: 1,
            'custom-event': 1,
        })
        .expect(captureLogger.count(() => true))
        .gte(1)

    // Check no requests failed
    await t.expect(captureLogger.count(({ response }) => response.statusCode !== 200)).eql(0)

    writeResultsJsonFile(t.testRun.test.name, testSessionId, assertCustomEventsWorkAndAreAccessibleViaApi)
})

export async function assertCustomEventsWorkAndAreAccessibleViaApi(testSessionId, deadline) {
    const results = await retryUntilResults(() => queryAPI(testSessionId), 3, { deadline })
    expect(results.length).toEqual(3)
    expect(results.filter(({ event }) => event === 'custom-event').length).toEqual(1)
    expect(results.filter(({ event }) => event === '$pageview').length).toEqual(1)
    expect(results.filter(({ event }) => event === '$autocapture').length).toEqual(1)
}

test('Autocaptured events work and are accessible via /api/event', async (t) => {
    const testSessionId = await initPosthog(t.testRun.test.name)
    await t
        .wait(5000)
        .expect(isLoaded())
        .ok()
        .click('[data-cy-link-mask-text]')
        .click('[data-cy-button-sensitive-attributes]')
        .wait(10000)
        .expect(capturesMap())
        .contains({
            $pageview: 1,
            $autocapture: 2,
        })
        .expect(captureLogger.count(() => true))
        .gte(2)

    writeResultsJsonFile(t.testRun.test.name, testSessionId, assertAutocapturedEventsWorkAndAreAccessibleViaApi)

    // Check no requests failed
    await t.expect(captureLogger.count(({ response }) => response.statusCode !== 200)).eql(0)
})

export async function assertAutocapturedEventsWorkAndAreAccessibleViaApi(testSessionId, deadline) {
    const results = await retryUntilResults(() => queryAPI(testSessionId), 3, {
        deadline,
    })

    expect(results.filter(({ event }) => event === '$pageview').length).toEqual(1)
    const autocapturedEvents = results.filter((e) => e.event === '$autocapture')

    await expect(autocapturedEvents.length).toEqual(2)

    const autocapturedLinkClickEvents = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'a')
    const autocapturedButtonClickEvents = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'button')

    await expect(autocapturedButtonClickEvents.length).toEqual(1)
    await expect(autocapturedLinkClickEvents.length).toEqual(1)

    const autocapturedButtonElement = autocapturedButtonClickEvents[0].elements[0]
    const autocapturedLinkElement = autocapturedLinkClickEvents[0].elements[0]

    // Captures text content if mask_all_text isn't set
    await expect(autocapturedLinkElement['text']).toEqual('Sensitive text!')

    const attrKeys = Object.keys(autocapturedButtonElement.attributes)
    attrKeys.sort()

    expect(attrKeys).toEqual([
        'attr__class',
        'attr__data-cy-button-sensitive-attributes',
        'attr__data-sensitive',
        'attr__id',
    ])
}

test('Config options change autocapture behavior accordingly', async (t) => {
    const testSessionId = await initPosthog(t.testRun.test.name, {
        mask_all_text: true,
        mask_all_element_attributes: true,
    })

    await t
        .wait(5000)
        .expect(isLoaded())
        .ok()
        .click('[data-cy-link-mask-text]')
        .click('[data-cy-button-sensitive-attributes]')
        .wait(10000)
        .expect(capturesMap())
        .contains({
            $pageview: 1,
            $autocapture: 2,
        })
        .expect(captureLogger.count(() => true))
        .gte(2)

    // Check no requests failed
    await t.expect(captureLogger.count(({ response }) => response.statusCode !== 200)).eql(0)

    writeResultsJsonFile(t.testRun.test.name, testSessionId, assertConfigOptionsChangeAutocaptureBehaviourAccordingly)
})

export async function assertConfigOptionsChangeAutocaptureBehaviourAccordingly(testSessionId, deadline) {
    const results = await retryUntilResults(() => queryAPI(testSessionId), 3, {
        deadline,
    })

    const autocapturedEvents = results.filter((e) => e.event === '$autocapture')
    await expect(autocapturedEvents.length).toEqual(2)

    const autocapturedLinkElement = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'a')[0].elements[0]
    const autocapturedButtonElement = autocapturedEvents.filter((e) => e.elements[0].tag_name === 'button')[0]
        .elements[0]

    // mask_all_text does not set $el_text
    await expect(autocapturedLinkElement['text']).toEqual(null)

    // mask_all_element_attributes does not capture any attributes at all from all elements
    await expect(Object.keys(autocapturedButtonElement.attributes).length).toEqual(0)
}
