import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { pollUntilEventCaptured } from '../utils/event-capture-utils'

const startOptions = {
    options: {},
    flagsResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

const openTextQuestion = {
    type: 'open',
    question: 'What feedback do you have for us?',
    description: 'Event-based survey with property filtering',
    id: 'open_text_1',
}

test.describe('surveys - event property filtering', () => {
    test('shows survey when event name matches without property filters', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'event-survey-1',
                            name: 'Event-based survey',
                            description: 'Survey triggered by purchase event',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: {
                                events: {
                                    values: [
                                        {
                                            name: 'purchase_completed',
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        // Survey should not be visible initially
        await expect(page.locator('.PostHogSurvey-event-survey-1').locator('.survey-form')).not.toBeInViewport()

        // Trigger the event
        await page.evaluate(() => {
            ;(window as any).posthog.capture('purchase_completed', {
                product_type: 'premium',
                amount: 100,
            })
        })

        // Survey should now be visible
        await expect(page.locator('.PostHogSurvey-event-survey-1').locator('.survey-form')).toBeVisible()
    })

    test('shows survey when event matches exact property filter', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'exact-filter-survey',
                            name: 'Exact property filter survey',
                            description: 'Survey triggered by purchase with exact product type',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: {
                                events: {
                                    values: [
                                        {
                                            name: 'purchase_completed',
                                            propertyFilters: {
                                                product_type: {
                                                    values: ['premium'],
                                                    operator: 'exact',
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        // Survey should not be visible initially
        await expect(page.locator('.PostHogSurvey-exact-filter-survey').locator('.survey-form')).not.toBeInViewport()

        // Trigger event with non-matching property
        await page.evaluate(() => {
            ;(window as any).posthog.capture('purchase_completed', {
                product_type: 'basic',
                amount: 50,
            })
        })

        // Survey should still not be visible
        await expect(page.locator('.PostHogSurvey-exact-filter-survey').locator('.survey-form')).not.toBeInViewport()

        // Trigger event with matching property
        await page.evaluate(() => {
            ;(window as any).posthog.capture('purchase_completed', {
                product_type: 'premium',
                amount: 100,
            })
        })

        // Survey should now be visible
        await expect(page.locator('.PostHogSurvey-exact-filter-survey').locator('.survey-form')).toBeVisible()
    })

    test('shows survey when event matches is_not property filter', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'is-not-filter-survey',
                            name: 'Is not property filter survey',
                            description: 'Survey triggered by purchase where product is not basic',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: {
                                events: {
                                    values: [
                                        {
                                            name: 'purchase_completed',
                                            propertyFilters: {
                                                product_type: {
                                                    values: ['basic'],
                                                    operator: 'is_not',
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        // Trigger event with excluded property value
        await page.evaluate(() => {
            ;(window as any).posthog.capture('purchase_completed', {
                product_type: 'basic',
            })
        })

        // Survey should not be visible
        await expect(page.locator('.PostHogSurvey-is-not-filter-survey').locator('.survey-form')).not.toBeInViewport()

        // Trigger event with different property value
        await page.evaluate(() => {
            ;(window as any).posthog.capture('purchase_completed', {
                product_type: 'premium',
            })
        })

        // Survey should now be visible
        await expect(page.locator('.PostHogSurvey-is-not-filter-survey').locator('.survey-form')).toBeVisible()
    })

    test('shows survey when event matches regex property filter', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'regex-filter-survey',
                            name: 'Regex property filter survey',
                            description: 'Survey triggered by page view with regex URL pattern',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: {
                                events: {
                                    values: [
                                        {
                                            name: 'page_view',
                                            propertyFilters: {
                                                url: {
                                                    values: ['/dashboard/.*'],
                                                    operator: 'regex',
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        // Trigger event with non-matching URL
        await page.evaluate(() => {
            ;(window as any).posthog.capture('page_view', {
                url: '/home',
            })
        })

        // Survey should not be visible
        await expect(page.locator('.PostHogSurvey-regex-filter-survey').locator('.survey-form')).not.toBeInViewport()

        // Trigger event with matching URL pattern
        await page.evaluate(() => {
            ;(window as any).posthog.capture('page_view', {
                url: '/dashboard/analytics',
            })
        })

        // Survey should now be visible
        await expect(page.locator('.PostHogSurvey-regex-filter-survey').locator('.survey-form')).toBeVisible()
    })

    test('shows survey when event matches icontains property filter', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'icontains-filter-survey',
                            name: 'Case-insensitive contains filter survey',
                            description: 'Survey triggered by search with case-insensitive contains',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: {
                                events: {
                                    values: [
                                        {
                                            name: 'search_performed',
                                            propertyFilters: {
                                                query: {
                                                    values: ['ANALYTICS'],
                                                    operator: 'icontains',
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        // Trigger event with non-matching search query
        await page.evaluate(() => {
            ;(window as any).posthog.capture('search_performed', {
                query: 'dashboard setup',
            })
        })

        // Survey should not be visible
        await expect(
            page.locator('.PostHogSurvey-icontains-filter-survey').locator('.survey-form')
        ).not.toBeInViewport()

        // Trigger event with case-insensitive matching query
        await page.evaluate(() => {
            ;(window as any).posthog.capture('search_performed', {
                query: 'advanced analytics features',
            })
        })

        // Survey should now be visible
        await expect(page.locator('.PostHogSurvey-icontains-filter-survey').locator('.survey-form')).toBeVisible()
    })

    test('shows survey when event matches multiple property filters (AND logic)', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'multi-filter-survey',
                            name: 'Multiple property filters survey',
                            description: 'Survey with multiple property conditions',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: {
                                events: {
                                    values: [
                                        {
                                            name: 'purchase_completed',
                                            propertyFilters: {
                                                product_type: {
                                                    values: ['premium'],
                                                    operator: 'exact',
                                                },
                                                amount: {
                                                    values: ['50'],
                                                    operator: 'is_not',
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        // Trigger event that matches only first condition
        await page.evaluate(() => {
            ;(window as any).posthog.capture('purchase_completed', {
                product_type: 'premium',
                amount: '50', // This should not match (is_not filter)
            })
        })

        // Survey should not be visible
        await expect(page.locator('.PostHogSurvey-multi-filter-survey').locator('.survey-form')).not.toBeInViewport()

        // Trigger event that matches both conditions
        await page.evaluate(() => {
            ;(window as any).posthog.capture('purchase_completed', {
                product_type: 'premium',
                amount: '100',
            })
        })

        // Survey should now be visible
        await expect(page.locator('.PostHogSurvey-multi-filter-survey').locator('.survey-form')).toBeVisible()
    })

    test('does not show survey when required property is missing', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'missing-prop-survey',
                            name: 'Missing property survey',
                            description: 'Survey that requires specific property',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: {
                                events: {
                                    values: [
                                        {
                                            name: 'user_action',
                                            propertyFilters: {
                                                required_field: {
                                                    values: ['expected_value'],
                                                    operator: 'exact',
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        // Trigger event without the required property
        await page.evaluate(() => {
            ;(window as any).posthog.capture('user_action', {
                other_field: 'some_value',
            })
        })

        // Survey should not be visible
        await expect(page.locator('.PostHogSurvey-missing-prop-survey').locator('.survey-form')).not.toBeInViewport()

        // Wait a bit to make sure it doesn't appear
        await page.waitForTimeout(1000)
        await expect(page.locator('.PostHogSurvey-missing-prop-survey').locator('.survey-form')).not.toBeInViewport()
    })

    test('not_regex property filter works correctly', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'not-regex-survey',
                            name: 'Not regex filter survey',
                            description: 'Survey triggered when URL does not match pattern',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: {
                                events: {
                                    values: [
                                        {
                                            name: 'page_view',
                                            propertyFilters: {
                                                url: {
                                                    values: ['/admin/.*'],
                                                    operator: 'not_regex',
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        // Trigger event with URL that matches the excluded pattern
        await page.evaluate(() => {
            ;(window as any).posthog.capture('page_view', {
                url: '/admin/users',
            })
        })

        // Survey should not be visible
        await expect(page.locator('.PostHogSurvey-not-regex-survey').locator('.survey-form')).not.toBeInViewport()

        // Trigger event with URL that doesn't match the excluded pattern
        await page.evaluate(() => {
            ;(window as any).posthog.capture('page_view', {
                url: '/dashboard/home',
            })
        })

        // Survey should now be visible
        await expect(page.locator('.PostHogSurvey-not-regex-survey').locator('.survey-form')).toBeVisible()
    })

    test('not_icontains property filter works correctly', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'not-icontains-survey',
                            name: 'Not case-insensitive contains filter survey',
                            description: 'Survey triggered when query does not contain excluded terms',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: {
                                events: {
                                    values: [
                                        {
                                            name: 'search_performed',
                                            propertyFilters: {
                                                query: {
                                                    values: ['ERROR'],
                                                    operator: 'not_icontains',
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        // Trigger event with query containing excluded term (case-insensitive)
        await page.evaluate(() => {
            ;(window as any).posthog.capture('search_performed', {
                query: 'system error logs',
            })
        })

        // Survey should not be visible
        await expect(page.locator('.PostHogSurvey-not-icontains-survey').locator('.survey-form')).not.toBeInViewport()

        // Trigger event with query that doesn't contain excluded term
        await page.evaluate(() => {
            ;(window as any).posthog.capture('search_performed', {
                query: 'user analytics dashboard',
            })
        })

        // Survey should now be visible
        await expect(page.locator('.PostHogSurvey-not-icontains-survey').locator('.survey-form')).toBeVisible()
    })

    test('survey captures correct events when triggered by property filters', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'event-capture-survey',
                            name: 'Event capture survey',
                            description: 'Survey for testing event capture',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: {
                                events: {
                                    values: [
                                        {
                                            name: 'form_submitted',
                                            propertyFilters: {
                                                form_type: {
                                                    values: ['contact'],
                                                    operator: 'exact',
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            })
        })

        const surveysResponse = page.waitForResponse('**/surveys/**')
        await start(startOptions, page, context)
        await surveysAPICall
        await surveysResponse

        // Survey should not be visible initially
        await expect(page.locator('.PostHogSurvey-event-capture-survey').locator('.survey-form')).not.toBeInViewport()

        // Trigger the event that should activate the survey
        await page.evaluate(() => {
            ;(window as any).posthog.capture('form_submitted', {
                form_type: 'contact',
                page: 'home',
            })
        })

        // Survey should now be visible
        await expect(page.locator('.PostHogSurvey-event-capture-survey').locator('.survey-form')).toBeVisible()

        // Verify survey shown event was captured
        await pollUntilEventCaptured(page, 'survey shown')

        // Fill out and submit the survey
        await page.locator('.PostHogSurvey-event-capture-survey textarea').type('Property filtering works great!')
        await page.locator('.PostHogSurvey-event-capture-survey .form-submit').click()

        // Verify survey sent event was captured
        await pollUntilEventCaptured(page, 'survey sent')

        const surveySentEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === 'survey sent'))

        expect(surveySentEvent).toBeDefined()
        expect(surveySentEvent?.properties?.['$survey_id']).toBe('event-capture-survey')
        expect(surveySentEvent?.properties?.['$survey_response_open_text_1']).toContain(
            'Property filtering works great!'
        )
    })
})
