import {
    assertAutocapturedEventsWorkAndAreAccessibleViaApi,
    assertConfigOptionsChangeAutocaptureBehaviourAccordingly,
    assertCustomEventsWorkAndAreAccessibleViaApi,
} from './checks'
import { test } from '../fixtures'

test.describe('ingestion', () => {
    test.use({
        url: '/playground/cypress-full/index.html',
        posthogOptions: {
            request_batching: false,
            bootstrap: {
                distinctID: 'automated-tester', // We set this to get around the ingestion delay for new distinctIDs
                isIdentifiedID: true,
            },
            opt_out_useragent_filter: true,
        },
    })

    test('Custom events work and are accessible via /api/event', async ({ page, events, posthog, ingestion }) => {
        await posthog.init()
        await page.delay(1000)
        await page.click('[data-cy-custom-event-button]')
        await page.delay(1000)
        await events.expectCountMap({
            $pageview: 1,
            $autocapture: 1,
            'custom-event': 1,
        })
        ingestion.addSessionCheck(posthog.getSessionId(), 3, assertCustomEventsWorkAndAreAccessibleViaApi)
    })

    test('Autocaptured events work and are accessible via /api/event', async ({ page, events, posthog, ingestion }) => {
        await posthog.init()
        await page.delay(500)
        await page.click('[data-cy-link-mask-text]')
        await page.click('[data-cy-button-sensitive-attributes]')
        await page.delay(5000)
        await events.expectCountMap({
            $pageview: 1,
            $autocapture: 2,
        })
        ingestion.addSessionCheck(posthog.getSessionId(), 3, assertAutocapturedEventsWorkAndAreAccessibleViaApi)
    })

    test('Config options change autocapture behavior accordingly', async ({ page, posthog, events, ingestion }) => {
        await posthog.init({
            mask_all_text: true,
            mask_all_element_attributes: true,
        })
        await page.delay(500)
        await page.click('[data-cy-link-mask-text]')
        await page.click('[data-cy-button-sensitive-attributes]')
        await page.delay(5000)
        await events.expectCountMap({
            $pageview: 1,
            $autocapture: 2,
        })
        ingestion.addSessionCheck(posthog.getSessionId(), 3, assertConfigOptionsChangeAutocaptureBehaviourAccordingly)
    })
})
