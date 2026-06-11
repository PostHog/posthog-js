import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import {
    createTour,
    createStep,
    startOptionsWithProductTours,
    tourTooltip,
    tourContainer,
    createFlagsOverride,
    startWithTours,
    tourDismissedKey,
    tourCompletedKey,
    tourShownKey,
    ACTIVE_TOUR_SESSION_KEY,
} from './utils'

test.describe('product tours - core display logic', () => {
    test('shows tour on first visit', async ({ page, context }) => {
        const tour = createTour({ id: 'tour-1' })
        await startWithTours(page, context, [tour])

        await expect(tourTooltip(page, 'tour-1')).toBeVisible({ timeout: 5000 })
    })

    test('does not re-show tour after dismissal (until_interacted)', async ({ page, context }) => {
        const tour = createTour({ id: 'tour-dismiss', display_frequency: 'until_interacted' })
        await startWithTours(page, context, [tour])

        const tooltip = tourTooltip(page, 'tour-dismiss')
        await expect(tooltip).toBeVisible({ timeout: 5000 })

        await tourContainer(page, 'tour-dismiss').locator('.ph-tour-dismiss').click()
        await expect(tooltip).not.toBeVisible()

        expect(await page.evaluate((key) => localStorage.getItem(key), tourDismissedKey('tour-dismiss'))).toBeTruthy()

        await page.reload()
        await start({ ...startOptionsWithProductTours, type: 'reload' }, page, context)
        await page.waitForTimeout(2000)

        await expect(tooltip).not.toBeInViewport()
    })

    test('does not re-show tour after completion', async ({ page, context }) => {
        const tour = createTour({ id: 'tour-complete', display_frequency: 'until_interacted' })
        await startWithTours(page, context, [tour])

        const tooltip = tourTooltip(page, 'tour-complete')
        await expect(tooltip).toBeVisible({ timeout: 5000 })

        await tourContainer(page, 'tour-complete').locator('button:has-text("Done")').click()
        await expect(tooltip).not.toBeVisible()

        expect(await page.evaluate((key) => localStorage.getItem(key), tourCompletedKey('tour-complete'))).toBeTruthy()

        await page.reload()
        await start({ ...startOptionsWithProductTours, type: 'reload' }, page, context)
        await page.waitForTimeout(2000)

        await expect(tooltip).not.toBeInViewport()
    })

    test.describe('display_frequency behavior', () => {
        test('always - shows again after completion', async ({ page, context }) => {
            const tour = createTour({ id: 'tour-always', display_frequency: 'always' })
            await startWithTours(page, context, [tour])

            const tooltip = tourTooltip(page, 'tour-always')
            await expect(tooltip).toBeVisible({ timeout: 5000 })

            await tourContainer(page, 'tour-always').locator('button:has-text("Done")').click()
            await expect(tooltip).not.toBeVisible()

            await page.reload()
            await start({ ...startOptionsWithProductTours, type: 'reload' }, page, context)

            await expect(tooltip).toBeVisible({ timeout: 5000 })
        })

        test('show_once - does not show in new session after being shown', async ({ page, context }) => {
            const tour = createTour({ id: 'tour-once', display_frequency: 'show_once' })
            await startWithTours(page, context, [tour])

            const tooltip = tourTooltip(page, 'tour-once')
            await expect(tooltip).toBeVisible({ timeout: 5000 })

            expect(await page.evaluate((key) => localStorage.getItem(key), tourShownKey('tour-once'))).toBeTruthy()

            await page.evaluate((key) => sessionStorage.removeItem(key), ACTIVE_TOUR_SESSION_KEY)

            await page.reload()
            await start({ ...startOptionsWithProductTours, type: 'reload' }, page, context)
            await page.waitForTimeout(2000)

            await expect(tooltip).not.toBeInViewport()
        })
    })

    test.describe('session resumption', () => {
        test('resumes tour on same-session page reload', async ({ page, context }) => {
            const tour = createTour({
                id: 'tour-resume',
                steps: [
                    createStep({ id: 'step-1', contentHtml: '<p>Step 1</p>' }),
                    createStep({ id: 'step-2', contentHtml: '<p>Step 2</p>' }),
                ],
            })
            await startWithTours(page, context, [tour])

            const tooltip = tourTooltip(page, 'tour-resume')
            await expect(tooltip).toBeVisible({ timeout: 5000 })
            await expect(tourContainer(page, 'tour-resume').locator('.ph-tour-content')).toContainText('Step 1')

            await tourContainer(page, 'tour-resume').locator('button:has-text("Next")').click()
            await expect(tourContainer(page, 'tour-resume').locator('.ph-tour-content')).toContainText('Step 2')

            await page.reload()
            await start({ ...startOptionsWithProductTours, type: 'reload' }, page, context)

            await expect(tooltip).toBeVisible({ timeout: 5000 })
            await expect(tourContainer(page, 'tour-resume').locator('.ph-tour-content')).toContainText('Step 2')
        })
    })

    test.describe('feature flag eligibility', () => {
        test('does not show tour when internal targeting flag is disabled', async ({ page, context }) => {
            const tour = createTour({
                id: 'tour-flag-disabled',
                internal_targeting_flag_key: 'disabled-flag',
            })
            await startWithTours(page, context, [tour], {
                startOptions: {
                    ...startOptionsWithProductTours,
                    flagsResponseOverrides: {
                        ...startOptionsWithProductTours.flagsResponseOverrides,
                        flags: createFlagsOverride({ 'disabled-flag': { enabled: false } }),
                    },
                },
            })

            await page.waitForTimeout(2000)
            await expect(tourTooltip(page, 'tour-flag-disabled')).not.toBeVisible()
        })

        test('shows tour when linked flag matches variant', async ({ page, context }) => {
            const tour = createTour({
                id: 'tour-variant',
                linked_flag_key: 'variant-flag',
                conditions: { linkedFlagVariant: 'test-variant' },
            })
            await startWithTours(page, context, [tour], {
                waitForApiResponse: true,
                startOptions: {
                    ...startOptionsWithProductTours,
                    flagsResponseOverrides: {
                        ...startOptionsWithProductTours.flagsResponseOverrides,
                        flags: createFlagsOverride({ 'variant-flag': { enabled: true, variant: 'test-variant' } }),
                    },
                },
            })

            await expect(tourTooltip(page, 'tour-variant')).toBeVisible({ timeout: 5000 })
        })

        test('does not show tour when linked flag variant does not match', async ({ page, context }) => {
            const tour = createTour({
                id: 'tour-wrong-variant',
                linked_flag_key: 'variant-flag',
                conditions: { linkedFlagVariant: 'expected-variant' },
            })
            await startWithTours(page, context, [tour], {
                startOptions: {
                    ...startOptionsWithProductTours,
                    flagsResponseOverrides: {
                        ...startOptionsWithProductTours.flagsResponseOverrides,
                        flags: createFlagsOverride({ 'variant-flag': { enabled: true, variant: 'different-variant' } }),
                    },
                },
            })

            await page.waitForTimeout(2000)
            await expect(tourTooltip(page, 'tour-wrong-variant')).not.toBeVisible()
        })
    })
})
