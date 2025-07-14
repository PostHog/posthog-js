import { test as base, expect, Page } from '@playwright/test'
import { extendPage } from '../utils/posthog-playwright-test-base'
import { initPostHog, writeResultsJsonFile } from './helpers'
import {
    assertAutocapturedEventsWorkAndAreAccessibleViaApi,
    assertConfigOptionsChangeAutocaptureBehaviourAccordingly,
    assertCustomEventsWorkAndAreAccessibleViaApi,
} from './checks'

const lazyLoadedJSFiles = [
    'array',
    'array.full',
    'recorder',
    'surveys',
    'exception-autocapture',
    'tracing-headers',
    'web-vitals',
    'dead-clicks-autocapture',
]

const currentEnv = process.env
export const {
    POSTHOG_PROJECT_KEY,
    POSTHOG_API_KEY,
    POSTHOG_API_HOST = 'https://us.i.posthog.com',
    POSTHOG_API_PROJECT = '11213',
    BRANCH_NAME,
    RUN_ID,
    BROWSER,
} = currentEnv

const test = base.extend<{ mockStaticAssets: void; page: Page }>({
    page: async ({ page }, use) => {
        extendPage(page)
        await use(page)
    },
    mockStaticAssets: [
        async ({ context }, use) => {
            lazyLoadedJSFiles.forEach((key: string) => {
                void context.route(new RegExp(`^.*/static/${key}\\.js(\\?.*)?$`), (route) => {
                    route.fulfill({
                        headers: {
                            loaded: 'using relative path by playwright',
                        },
                        path: `./dist/${key}.js`,
                    })
                })

                void context.route(`**/static/${key}.js.map`, (route) => {
                    route.fulfill({
                        headers: { loaded: 'using relative path by playwright' },
                        path: `./dist/${key}.js.map`,
                    })
                })
            })

            await use()
        },
        { auto: true },
    ],
})

test.describe('ingestion', () => {
    test('Custom events work and are accessible via /api/event', async ({ page }, testInfo) => {
        const responses: Response[] = []
        const testSessionId = await initPostHog(page, testInfo.title, responses)
        await page.delay(1000)
        await page.click('[data-cy-custom-event-button]')
        await page.delay(1000)
        await page.expectEventsCount({
            $pageview: 1,
            $autocapture: 1,
            'custom-event': 1,
        })
        expect(responses.filter((response) => !response.ok)).toHaveLength(0)
        await page.close()
        writeResultsJsonFile(testInfo.title, testSessionId, assertCustomEventsWorkAndAreAccessibleViaApi)
    })

    test('Autocaptured events work and are accessible via /api/event', async ({ page }, testInfo) => {
        const responses: Response[] = []
        const testSessionId = await initPostHog(page, testInfo.title, responses)
        await page.delay(500)
        await page.click('[data-cy-link-mask-text]')
        await page.click('[data-cy-button-sensitive-attributes]')
        await page.delay(5000)
        await page.expectEventsCount({
            $pageview: 1,
            $autocapture: 2,
        })
        expect(responses.filter((response) => !response.ok)).toHaveLength(0)
        writeResultsJsonFile(testInfo.title, testSessionId, assertAutocapturedEventsWorkAndAreAccessibleViaApi)
    })

    test('Config options change autocapture behavior accordingly', async ({ page }, testInfo) => {
        const responses: Response[] = []
        const testSessionId = await initPostHog(page, testInfo.title, responses, {
            mask_all_text: true,
            mask_all_element_attributes: true,
        })
        await page.delay(500)

        await page.click('[data-cy-link-mask-text]')
        await page.click('[data-cy-button-sensitive-attributes]')
        await page.delay(5000)
        await page.expectEventsCount({
            $pageview: 1,
            $autocapture: 2,
        })
        expect(responses.filter((response) => !response.ok)).toHaveLength(0)
        writeResultsJsonFile(testInfo.title, testSessionId, assertConfigOptionsChangeAutocaptureBehaviourAccordingly)
    })
})
