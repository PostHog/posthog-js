import { expect, test } from '../utils/posthog-playwright-test-base'
import { start, gotoPage } from '../utils/setup'
import {
    createTour,
    startOptionsWithProductTours,
    startWithTours,
    tourTooltip,
    tourContainer,
    LAST_SEEN_TOUR_DATE_KEY_PREFIX,
} from './utils'

test.describe('product tours - wait period', () => {
    test('shows tour when no seenTourWaitPeriod is configured', async ({ page, context }) => {
        const tour = createTour({ id: 'no-wait-period', tour_type: 'tour' })
        await startWithTours(page, context, [tour])

        await expect(tourTooltip(page, 'no-wait-period')).toBeVisible({ timeout: 5000 })
    })

    test('blocks tour when within wait period for matching type', async ({ page, context }) => {
        // Navigate first to establish localStorage
        await gotoPage(page, './playground/cypress/index.html')

        // Seed a recent seen date for 'tour' type (seen today)
        await page.evaluate(({ key, value }: { key: string; value: string }) => localStorage.setItem(key, value), {
            key: `${LAST_SEEN_TOUR_DATE_KEY_PREFIX}tour`,
            value: JSON.stringify(new Date().toISOString()),
        })

        const tour = createTour({
            id: 'wait-blocked',
            tour_type: 'tour',
            conditions: {
                seenTourWaitPeriod: { days: 7, types: ['tour'] },
            },
        })

        await startWithTours(page, context, [tour], {
            startOptions: { ...startOptionsWithProductTours, type: 'reload' },
        })

        await page.waitForTimeout(2000)
        await expect(tourTooltip(page, 'wait-blocked')).not.toBeVisible()
    })

    test('shows tour when wait period has passed', async ({ page, context }) => {
        // Navigate first to establish localStorage
        await gotoPage(page, './playground/cypress/index.html')

        // Seed a seen date from 10 days ago (past the 7-day wait period)
        await page.evaluate(({ key, value }: { key: string; value: string }) => localStorage.setItem(key, value), {
            key: `${LAST_SEEN_TOUR_DATE_KEY_PREFIX}tour`,
            value: JSON.stringify(new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString()),
        })

        const tour = createTour({
            id: 'wait-passed',
            tour_type: 'tour',
            conditions: {
                seenTourWaitPeriod: { days: 7, types: ['tour'] },
            },
        })

        await startWithTours(page, context, [tour], {
            startOptions: { ...startOptionsWithProductTours, type: 'reload' },
        })

        await expect(tourTooltip(page, 'wait-passed')).toBeVisible({ timeout: 5000 })
    })

    test('shows tour when wait period type does not match stored type', async ({ page, context }) => {
        // Navigate first to establish localStorage
        await gotoPage(page, './playground/cypress/index.html')

        // Seed a recent seen date for 'announcement' type
        await page.evaluate(({ key, value }: { key: string; value: string }) => localStorage.setItem(key, value), {
            key: `${LAST_SEEN_TOUR_DATE_KEY_PREFIX}announcement`,
            value: JSON.stringify(new Date().toISOString()),
        })

        // Tour with wait period only checking 'tour' type — should NOT be blocked by 'announcement'
        const tour = createTour({
            id: 'wait-type-mismatch',
            tour_type: 'tour',
            conditions: {
                seenTourWaitPeriod: { days: 7, types: ['tour'] },
            },
        })

        await startWithTours(page, context, [tour], {
            startOptions: { ...startOptionsWithProductTours, type: 'reload' },
        })

        await expect(tourTooltip(page, 'wait-type-mismatch')).toBeVisible({ timeout: 5000 })
    })

    test('blocks tour when any of the configured types was seen recently', async ({ page, context }) => {
        // Navigate first to establish localStorage
        await gotoPage(page, './playground/cypress/index.html')

        // 'tour' was seen long ago, but 'announcement' was seen today
        await page.evaluate(
            ({ prefix }: { prefix: string }) => {
                const oldDate = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString()
                const recentDate = new Date().toISOString()
                localStorage.setItem(`${prefix}tour`, JSON.stringify(oldDate))
                localStorage.setItem(`${prefix}announcement`, JSON.stringify(recentDate))
            },
            { prefix: LAST_SEEN_TOUR_DATE_KEY_PREFIX }
        )

        const tour = createTour({
            id: 'wait-multi-type',
            tour_type: 'tour',
            conditions: {
                seenTourWaitPeriod: { days: 7, types: ['tour', 'announcement'] },
            },
        })

        await startWithTours(page, context, [tour], {
            startOptions: { ...startOptionsWithProductTours, type: 'reload' },
        })

        await page.waitForTimeout(2000)
        await expect(tourTooltip(page, 'wait-multi-type')).not.toBeVisible()
    })

    test('showing a tour stores the last seen date for its tour_type', async ({ page, context }) => {
        const tour = createTour({ id: 'stores-date', tour_type: 'announcement' })
        await startWithTours(page, context, [tour])

        await expect(tourTooltip(page, 'stores-date')).toBeVisible({ timeout: 5000 })

        const storedValue = await page.evaluate(
            (key: string) => localStorage.getItem(key),
            `${LAST_SEEN_TOUR_DATE_KEY_PREFIX}announcement`
        )

        expect(storedValue).toBeTruthy()
        const parsed = new Date(JSON.parse(storedValue!))
        expect(parsed.getTime()).toBeGreaterThan(Date.now() - 60_000) // within last minute
    })

    test('second tour blocked by wait period after first tour shown', async ({ page, context }) => {
        // Show first tour (type 'tour'), which sets the last seen date
        const firstTour = createTour({ id: 'first-tour', tour_type: 'tour' })
        await startWithTours(page, context, [firstTour])

        const firstTooltip = tourTooltip(page, 'first-tour')
        await expect(firstTooltip).toBeVisible({ timeout: 5000 })

        // Dismiss the first tour
        await tourContainer(page, 'first-tour').locator('.ph-tour-dismiss').click()
        await expect(firstTooltip).not.toBeVisible()

        // Now reload with a second tour that has a wait period checking 'tour' type
        const secondTour = createTour({
            id: 'second-tour',
            tour_type: 'tour',
            conditions: {
                seenTourWaitPeriod: { days: 7, types: ['tour'] },
            },
        })

        await page.route('**/api/product_tours/**', async (route) => {
            await route.fulfill({ json: { product_tours: [secondTour] } })
        })

        await page.reload()
        await start({ ...startOptionsWithProductTours, type: 'reload' }, page, context)

        await page.waitForTimeout(2000)
        await expect(tourTooltip(page, 'second-tour')).not.toBeVisible()
    })
})
