import { expect, test } from '../utils/posthog-playwright-test-base'
import { createTour, tourTooltip, startWithTours, captureEvent } from './utils'

test.describe('product tours - auto triggers', () => {
    test('shows immediately when auto_launch with no event triggers', async ({ page, context }) => {
        const tour = createTour({ id: 'auto-immediate', auto_launch: true })
        await startWithTours(page, context, [tour])

        await expect(tourTooltip(page, 'auto-immediate')).toBeVisible({ timeout: 5000 })
    })

    test('does not show when auto_launch is false', async ({ page, context }) => {
        const tour = createTour({ id: 'no-auto', auto_launch: false })
        await startWithTours(page, context, [tour])

        await page.waitForTimeout(2000)
        await expect(tourTooltip(page, 'no-auto')).not.toBeVisible()
    })

    test('waits for event trigger before showing', async ({ page, context }) => {
        const tour = createTour({
            id: 'event-trigger',
            auto_launch: true,
            conditions: {
                events: { values: [{ name: 'trigger_tour_event' }] },
            },
        })

        await startWithTours(page, context, [tour], { waitForApiResponse: true })

        await expect(tourTooltip(page, 'event-trigger')).not.toBeVisible()

        await captureEvent(page, 'trigger_tour_event')

        await expect(tourTooltip(page, 'event-trigger')).toBeVisible({ timeout: 5000 })
    })

    test('respects autoShowDelaySeconds', async ({ page, context }) => {
        const tour = createTour({
            id: 'delayed-tour',
            auto_launch: true,
            conditions: {
                autoShowDelaySeconds: 3,
                events: { values: [{ name: 'delay_trigger' }] },
            },
        })

        await startWithTours(page, context, [tour], { waitForApiResponse: true })

        await captureEvent(page, 'delay_trigger')

        await page.waitForTimeout(2000)
        await expect(tourTooltip(page, 'delayed-tour')).not.toBeVisible()

        await expect(tourTooltip(page, 'delayed-tour')).toBeVisible({ timeout: 5000 })
    })

    test('cancel event cancels pending delayed tour', async ({ page, context }) => {
        const tour = createTour({
            id: 'cancel-test',
            auto_launch: true,
            conditions: {
                autoShowDelaySeconds: 5,
                events: { values: [{ name: 'start_tour' }] },
                cancelEvents: { values: [{ name: 'cancel_tour' }] },
            },
        })

        await startWithTours(page, context, [tour], { waitForApiResponse: true })

        await captureEvent(page, 'start_tour')

        await page.waitForTimeout(2000)

        await captureEvent(page, 'cancel_tour')

        await page.waitForTimeout(4000)

        await expect(tourTooltip(page, 'cancel-test')).not.toBeVisible()
    })

    test('selector click trigger shows tour', async ({ page, context }) => {
        const tour = createTour({
            id: 'click-trigger',
            auto_launch: false,
            conditions: { selector: '#click-trigger-btn' },
        })

        await startWithTours(page, context, [tour])

        await page.waitForTimeout(2000)

        await expect(tourTooltip(page, 'click-trigger')).not.toBeVisible()

        await page.click('#click-trigger-btn')

        await expect(tourTooltip(page, 'click-trigger')).toBeVisible({ timeout: 5000 })
    })

    test.describe('event property filtering', () => {
        test('triggers when event properties match (exact)', async ({ page, context }) => {
            const tour = createTour({
                id: 'prop-filter-exact',
                auto_launch: true,
                conditions: {
                    events: {
                        values: [
                            {
                                name: 'filtered_event',
                                propertyFilters: {
                                    plan: { values: ['enterprise'], operator: 'exact' },
                                },
                            },
                        ],
                    },
                },
            })

            await startWithTours(page, context, [tour], { waitForApiResponse: true })

            await captureEvent(page, 'filtered_event', { plan: 'enterprise' })

            await expect(tourTooltip(page, 'prop-filter-exact')).toBeVisible({ timeout: 5000 })
        })

        test('does not trigger when event properties do not match', async ({ page, context }) => {
            const tour = createTour({
                id: 'prop-filter-mismatch',
                auto_launch: true,
                conditions: {
                    events: {
                        values: [
                            {
                                name: 'filtered_event',
                                propertyFilters: {
                                    plan: { values: ['enterprise'], operator: 'exact' },
                                },
                            },
                        ],
                    },
                },
            })

            await startWithTours(page, context, [tour], { waitForApiResponse: true })

            await captureEvent(page, 'filtered_event', { plan: 'free' })

            await page.waitForTimeout(2000)
            await expect(tourTooltip(page, 'prop-filter-mismatch')).not.toBeVisible()
        })

        test('does not trigger when event is missing required property', async ({ page, context }) => {
            const tour = createTour({
                id: 'prop-filter-missing',
                auto_launch: true,
                conditions: {
                    events: {
                        values: [
                            {
                                name: 'filtered_event',
                                propertyFilters: {
                                    plan: { values: ['enterprise'], operator: 'exact' },
                                },
                            },
                        ],
                    },
                },
            })

            await startWithTours(page, context, [tour], { waitForApiResponse: true })

            await captureEvent(page, 'filtered_event', { other_prop: 'value' })

            await page.waitForTimeout(2000)
            await expect(tourTooltip(page, 'prop-filter-missing')).not.toBeVisible()
        })

        test('triggers with contains operator', async ({ page, context }) => {
            const tour = createTour({
                id: 'prop-filter-contains',
                auto_launch: true,
                conditions: {
                    events: {
                        values: [
                            {
                                name: 'filtered_event',
                                propertyFilters: {
                                    email: { values: ['@company.com'], operator: 'icontains' },
                                },
                            },
                        ],
                    },
                },
            })

            await startWithTours(page, context, [tour], { waitForApiResponse: true })

            await captureEvent(page, 'filtered_event', { email: 'user@company.com' })

            await expect(tourTooltip(page, 'prop-filter-contains')).toBeVisible({ timeout: 5000 })
        })

        test('triggers with is_not operator', async ({ page, context }) => {
            const tour = createTour({
                id: 'prop-filter-is-not',
                auto_launch: true,
                conditions: {
                    events: {
                        values: [
                            {
                                name: 'filtered_event',
                                propertyFilters: {
                                    status: { values: ['inactive'], operator: 'is_not' },
                                },
                            },
                        ],
                    },
                },
            })

            await startWithTours(page, context, [tour], { waitForApiResponse: true })

            await captureEvent(page, 'filtered_event', { status: 'active' })

            await expect(tourTooltip(page, 'prop-filter-is-not')).toBeVisible({ timeout: 5000 })
        })

        test('multiple property filters must all match', async ({ page, context }) => {
            const tour = createTour({
                id: 'prop-filter-multi',
                auto_launch: true,
                conditions: {
                    events: {
                        values: [
                            {
                                name: 'filtered_event',
                                propertyFilters: {
                                    plan: { values: ['enterprise'], operator: 'exact' },
                                    region: { values: ['us', 'eu'], operator: 'exact' },
                                },
                            },
                        ],
                    },
                },
            })

            await startWithTours(page, context, [tour], { waitForApiResponse: true })

            await captureEvent(page, 'filtered_event', { plan: 'enterprise', region: 'asia' })

            await page.waitForTimeout(2000)
            await expect(tourTooltip(page, 'prop-filter-multi')).not.toBeVisible()

            await captureEvent(page, 'filtered_event', { plan: 'enterprise', region: 'us' })

            await expect(tourTooltip(page, 'prop-filter-multi')).toBeVisible({ timeout: 5000 })
        })
    })
})
