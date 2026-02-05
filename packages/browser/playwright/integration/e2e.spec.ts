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
        mockIngestion: false,
    })

    test('Custom events work and are accessible via /api/event', async ({ page, events, posthog, ingestion }) => {
        await posthog.init()
        await events.waitForEvent('$pageview')
        await page.click('[data-cy-custom-event-button]')
        await events.waitForEvent('custom-event')
        events.expectCountMap({
            $pageview: 1,
            $autocapture: 1,
            'custom-event': 1,
        })
        await page.delay(1000)
        ingestion.addSessionCheck(posthog, 3, assertCustomEventsWorkAndAreAccessibleViaApi)
    })

    test('Autocaptured events work and are accessible via /api/event', async ({ page, events, posthog, ingestion }) => {
        await posthog.init()
        await page.delay(500)
        await page.click('[data-cy-link-mask-text]')
        await page.click('[data-cy-button-sensitive-attributes]')
        await page.delay(1000)
        events.expectCountMap({
            $pageview: 1,
            $autocapture: 2,
        })
        await page.delay(1000)
        ingestion.addSessionCheck(posthog, 3, assertAutocapturedEventsWorkAndAreAccessibleViaApi)
    })

    test('Config options change autocapture behavior accordingly', async ({ page, posthog, events, ingestion }) => {
        await posthog.init({
            mask_all_text: true,
            mask_all_element_attributes: true,
        })
        await page.delay(500)
        await page.click('[data-cy-link-mask-text]')
        await page.click('[data-cy-button-sensitive-attributes]')
        await page.delay(1000)
        events.expectCountMap({
            $pageview: 1,
            $autocapture: 2,
        })
        await page.delay(1000)
        ingestion.addSessionCheck(posthog, 3, assertConfigOptionsChangeAutocaptureBehaviourAccordingly)
    })
})
