import { expect, test } from '../utils/posthog-playwright-test-base'
import {
    createTour,
    createStep,
    createElementStep,
    createBannerStep,
    tourTooltip,
    tourContainer,
    startWithTours,
    tourDismissedKey,
} from './utils'

test.describe('product tours - step types and positioning', () => {
    test.describe('element steps', () => {
        test('tooltip appears near target element', async ({ page, context }) => {
            const tour = createTour({
                id: 'element-tour',
                steps: [createElementStep('#tour-target', { contentHtml: '<p>Click the button</p>' })],
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'element-tour')).toBeVisible({ timeout: 5000 })

            const targetBox = await page.locator('#tour-target').boundingBox()
            const tooltipBox = await tourContainer(page, 'element-tour').locator('.ph-tour-tooltip').boundingBox()

            expect(targetBox).toBeTruthy()
            expect(tooltipBox).toBeTruthy()

            const closestEdgeDistance = Math.min(
                Math.abs(tooltipBox!.x - (targetBox!.x + targetBox!.width)), // tooltip to right of target
                Math.abs(tooltipBox!.x + tooltipBox!.width - targetBox!.x), // tooltip to left of target
                Math.abs(tooltipBox!.y - (targetBox!.y + targetBox!.height)), // tooltip below target
                Math.abs(tooltipBox!.y + tooltipBox!.height - targetBox!.y)
            )
            expect(closestEdgeDistance).toBeLessThan(50)
        })

        test('progressionTrigger: click - clicking spotlight advances tour', async ({ page, context }) => {
            const tour = createTour({
                id: 'click-progress',
                steps: [
                    createElementStep('#tour-target', {
                        id: 'step-1',
                        progressionTrigger: 'click',
                        contentHtml: '<p>Click the target to continue</p>',
                    }),
                    createStep({ id: 'step-2', contentHtml: '<p>Step 2</p>' }),
                ],
            })
            await startWithTours(page, context, [tour])

            const container = tourContainer(page, 'click-progress')
            await expect(tourTooltip(page, 'click-progress')).toBeVisible({ timeout: 5000 })
            await expect(container.locator('.ph-tour-content')).toContainText('Click the target')

            await expect(container.locator('button:has-text("Next")')).not.toBeVisible()

            await container.locator('.ph-tour-spotlight').click()

            await expect(container.locator('.ph-tour-content')).toContainText('Step 2')
        })

        test('progressionTrigger: button - Next button advances tour (default)', async ({ page, context }) => {
            const tour = createTour({
                id: 'button-progress',
                steps: [
                    createElementStep('#tour-target', {
                        id: 'step-1',
                        progressionTrigger: 'button',
                        contentHtml: '<p>Step 1 with button</p>',
                    }),
                    createStep({ id: 'step-2', contentHtml: '<p>Step 2</p>' }),
                ],
            })
            await startWithTours(page, context, [tour])

            const container = tourContainer(page, 'button-progress')
            await expect(tourTooltip(page, 'button-progress')).toBeVisible({ timeout: 5000 })

            await expect(container.locator('button:has-text("Next")')).toBeVisible()

            await container.locator('button:has-text("Next")').click()
            await expect(container.locator('.ph-tour-content')).toContainText('Step 2')
        })

        test('spotlight highlights target element', async ({ page, context }) => {
            const tour = createTour({
                id: 'spotlight-tour',
                steps: [createElementStep('#tour-target', { contentHtml: '<p>Look at this element</p>' })],
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'spotlight-tour')).toBeVisible({ timeout: 5000 })

            const spotlight = tourContainer(page, 'spotlight-tour').locator('.ph-tour-spotlight')
            await expect(spotlight).toBeVisible()
        })
    })

    test.describe('dismiss on click outside', () => {
        test('clicking outside tour dismisses it by default', async ({ page, context }) => {
            const tour = createTour({
                id: 'dismiss-outside',
                steps: [createStep({ contentHtml: '<p>Click outside to dismiss</p>' })],
            })
            await startWithTours(page, context, [tour])

            const tooltip = tourTooltip(page, 'dismiss-outside')
            await expect(tooltip).toBeVisible({ timeout: 5000 })

            await tourContainer(page, 'dismiss-outside')
                .locator('.ph-tour-click-overlay')
                .click({ position: { x: 10, y: 10 } })

            await expect(tooltip).not.toBeVisible()
            expect(
                await page.evaluate((key) => localStorage.getItem(key), tourDismissedKey('dismiss-outside'))
            ).toBeTruthy()
        })

        test('dismissOnClickOutside: false prevents dismiss on outside click', async ({ page, context }) => {
            const tour = createTour({
                id: 'no-dismiss-outside',
                steps: [createStep({ contentHtml: '<p>Cannot dismiss by clicking outside</p>' })],
                appearance: { dismissOnClickOutside: false },
            })
            await startWithTours(page, context, [tour])

            const container = tourContainer(page, 'no-dismiss-outside')
            const tooltip = tourTooltip(page, 'no-dismiss-outside')
            await expect(tooltip).toBeVisible({ timeout: 5000 })

            await expect(container.locator('.ph-tour-click-overlay')).not.toBeVisible()

            await expect(tooltip).toBeVisible()
        })

        test('showOverlay: true shows dark overlay background', async ({ page, context }) => {
            const tour = createTour({
                id: 'with-overlay',
                steps: [createStep({ contentHtml: '<p>With overlay</p>' })],
                appearance: { showOverlay: true },
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'with-overlay')).toBeVisible({ timeout: 5000 })

            const overlayColor = await page.evaluate(() => {
                const container = document.querySelector('.ph-product-tour-container-with-overlay')
                const tourContainer = container?.shadowRoot?.querySelector('.ph-tour-container') as HTMLElement
                return getComputedStyle(tourContainer).getPropertyValue('--ph-tour-overlay-color')
            })
            expect(overlayColor.trim()).toContain('rgba(0, 0, 0')
        })

        test('showOverlay: false shows transparent overlay', async ({ page, context }) => {
            const tour = createTour({
                id: 'no-overlay',
                steps: [createStep({ contentHtml: '<p>No overlay</p>' })],
                appearance: { showOverlay: false },
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'no-overlay')).toBeVisible({ timeout: 5000 })

            const overlayColor = await page.evaluate(() => {
                const container = document.querySelector('.ph-product-tour-container-no-overlay')
                const tourContainer = container?.shadowRoot?.querySelector('.ph-tour-container') as HTMLElement
                return getComputedStyle(tourContainer).getPropertyValue('--ph-tour-overlay-color')
            })
            expect(overlayColor.trim()).toBe('transparent')
        })
    })

    test.describe('modal steps', () => {
        test('modal appears centered on screen', async ({ page, context }) => {
            const tour = createTour({
                id: 'modal-tour',
                steps: [createStep({ type: 'modal', contentHtml: '<p>Modal content</p>' })],
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'modal-tour')).toBeVisible({ timeout: 5000 })

            const tooltipBox = await tourContainer(page, 'modal-tour').locator('.ph-tour-tooltip').boundingBox()
            const viewport = page.viewportSize()

            expect(tooltipBox).toBeTruthy()
            expect(viewport).toBeTruthy()

            const tooltipCenterX = tooltipBox!.x + tooltipBox!.width / 2
            const viewportCenterX = viewport!.width / 2
            expect(Math.abs(tooltipCenterX - viewportCenterX)).toBeLessThan(50)
        })

        test('modal does not show spotlight', async ({ page, context }) => {
            const tour = createTour({
                id: 'modal-no-spotlight',
                steps: [createStep({ type: 'modal', contentHtml: '<p>Modal content</p>' })],
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'modal-no-spotlight')).toBeVisible({ timeout: 5000 })

            const spotlight = tourContainer(page, 'modal-no-spotlight').locator('.ph-tour-spotlight')
            await expect(spotlight).not.toBeVisible()
        })
    })

    test.describe('banner steps', () => {
        const bannerBehaviors = [
            {
                behavior: 'static' as const,
                selector: undefined,
                expectedClass: null,
                expectedParent: 'body',
            },
            {
                behavior: 'sticky' as const,
                selector: undefined,
                expectedClass: 'ph-tour-banner--sticky',
                expectedParent: 'body',
            },
            {
                behavior: 'custom' as const,
                selector: '#custom-banner-container',
                expectedClass: 'ph-tour-banner--custom',
                expectedParent: '#custom-banner-container',
            },
        ]

        for (const { behavior, selector, expectedClass, expectedParent } of bannerBehaviors) {
            test(`${behavior} banner renders correctly`, async ({ page, context }) => {
                const tourId = `${behavior}-banner`
                const tour = createTour({
                    id: tourId,
                    steps: [createBannerStep({ bannerConfig: { behavior, selector } })],
                })
                await startWithTours(page, context, [tour])

                const banner = tourContainer(page, tourId).locator('.ph-tour-banner')
                await expect(banner).toBeVisible({ timeout: 5000 })

                if (expectedClass) {
                    await expect(banner).toHaveClass(new RegExp(expectedClass))
                }

                const parentSelector = await page.evaluate(
                    ({ tourId, expectedParent }) => {
                        const container = document.querySelector(`.ph-product-tour-container-${tourId}`)
                        if (expectedParent === 'body') {
                            return container?.parentElement === document.body
                        }
                        return document.querySelector(expectedParent)?.contains(container)
                    },
                    { tourId, expectedParent }
                )
                expect(parentSelector).toBe(true)
            })
        }

        test('custom banner does not render when selector not found', async ({ page, context }) => {
            const tour = createTour({
                id: 'custom-missing',
                steps: [createBannerStep({ bannerConfig: { behavior: 'custom', selector: '#nonexistent' } })],
            })
            await startWithTours(page, context, [tour])

            // Wait for tour to be shown then dismissed
            await expect
                .poll(() => page.evaluate((key) => localStorage.getItem(key), tourDismissedKey('custom-missing')))
                .toBeTruthy()

            // Banner should not be visible
            const banner = tourContainer(page, 'custom-missing').locator('.ph-tour-banner')
            await expect(banner).not.toBeVisible()
        })

        test('banner can be dismissed', async ({ page, context }) => {
            const tour = createTour({
                id: 'banner-dismiss',
                steps: [createBannerStep()],
            })
            await startWithTours(page, context, [tour])

            const container = tourContainer(page, 'banner-dismiss')
            const banner = container.locator('.ph-tour-banner')
            await expect(banner).toBeVisible({ timeout: 5000 })

            await container.locator('.ph-tour-banner-dismiss').click()
            await expect(banner).not.toBeVisible()
            expect(
                await page.evaluate((key) => localStorage.getItem(key), tourDismissedKey('banner-dismiss'))
            ).toBeTruthy()
        })

        test('banner hides dismiss button when display_frequency is always', async ({ page, context }) => {
            const tour = createTour({
                id: 'banner-no-dismiss',
                steps: [createBannerStep()],
                display_frequency: 'always',
            })
            await startWithTours(page, context, [tour])

            const container = tourContainer(page, 'banner-no-dismiss')
            await expect(container.locator('.ph-tour-banner')).toBeVisible({ timeout: 5000 })
            await expect(container.locator('.ph-tour-banner-dismiss')).not.toBeVisible()
        })
    })
})
