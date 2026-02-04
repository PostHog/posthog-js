import { SurveyPosition } from '@posthog/core'
import { expect, test } from '../utils/posthog-playwright-test-base'
import { createTour, createStep, tourTooltip, tourContainer, startWithTours } from './utils'

test.describe('product tours - customization', () => {
    test.describe('appearance styling', () => {
        test('applies custom background color', async ({ page, context }) => {
            const tour = createTour({
                id: 'custom-bg',
                steps: [createStep({ contentHtml: '<p>Custom background</p>' })],
                appearance: { backgroundColor: '#ff0000' },
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'custom-bg')).toBeVisible({ timeout: 5000 })

            const bgColor = await page.evaluate(() => {
                const container = document.querySelector('[class*="ph-product-tour-container-custom-bg"]')
                const tooltip = container?.shadowRoot?.querySelector('.ph-tour-tooltip') as HTMLElement
                return getComputedStyle(tooltip).backgroundColor
            })
            expect(bgColor).toBe('rgb(255, 0, 0)')
        })

        test('applies custom text color', async ({ page, context }) => {
            const tour = createTour({
                id: 'custom-text',
                steps: [createStep({ contentHtml: '<p>Custom text color</p>' })],
                appearance: { textColor: '#00ff00' },
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'custom-text')).toBeVisible({ timeout: 5000 })

            const textColor = await page.evaluate(() => {
                const container = document.querySelector('[class*="ph-product-tour-container-custom-text"]')
                const content = container?.shadowRoot?.querySelector('.ph-tour-content') as HTMLElement
                return getComputedStyle(content).color
            })
            expect(textColor).toBe('rgb(0, 255, 0)')
        })

        test('applies custom button color', async ({ page, context }) => {
            const tour = createTour({
                id: 'custom-btn',
                steps: [createStep({ contentHtml: '<p>Custom button</p>' })],
                appearance: { buttonColor: '#0000ff' },
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'custom-btn')).toBeVisible({ timeout: 5000 })

            const btnBgColor = await page.evaluate(() => {
                const container = document.querySelector('[class*="ph-product-tour-container-custom-btn"]')
                const button = container?.shadowRoot?.querySelector('.ph-tour-footer button') as HTMLElement
                return getComputedStyle(button).backgroundColor
            })
            expect(btnBgColor).toBe('rgb(0, 0, 255)')
        })

        test('applies custom border radius', async ({ page, context }) => {
            const tour = createTour({
                id: 'custom-radius',
                steps: [createStep({ contentHtml: '<p>Custom radius</p>' })],
                appearance: { borderRadius: 20 },
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'custom-radius')).toBeVisible({ timeout: 5000 })

            const borderRadius = await page.evaluate(() => {
                const container = document.querySelector('[class*="ph-product-tour-container-custom-radius"]')
                const tooltip = container?.shadowRoot?.querySelector('.ph-tour-tooltip') as HTMLElement
                return getComputedStyle(tooltip).borderRadius
            })
            expect(borderRadius).toBe('20px')
        })

        test('whiteLabel hides PostHog branding', async ({ page, context }) => {
            const tour = createTour({
                id: 'white-label',
                steps: [createStep({ contentHtml: '<p>White label tour</p>' })],
                appearance: { whiteLabel: true },
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'white-label')).toBeVisible({ timeout: 5000 })

            const brandingVisible = await page.evaluate(() => {
                const container = document.querySelector('[class*="ph-product-tour-container-white-label"]')
                const branding = container?.shadowRoot?.querySelector('.ph-tour-branding') as HTMLElement | null
                return branding !== null && getComputedStyle(branding).display !== 'none'
            })
            expect(brandingVisible).toBe(false)
        })

        test('applies custom button border radius', async ({ page, context }) => {
            const tour = createTour({
                id: 'custom-btn-radius',
                steps: [createStep({ contentHtml: '<p>Custom button radius</p>' })],
                appearance: { buttonBorderRadius: 16 },
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'custom-btn-radius')).toBeVisible({ timeout: 5000 })

            const btnRadius = await page.evaluate(() => {
                const container = document.querySelector('[class*="ph-product-tour-container-custom-btn-radius"]')
                const button = container?.shadowRoot?.querySelector('.ph-tour-footer button') as HTMLElement
                return getComputedStyle(button).borderRadius
            })
            expect(btnRadius).toBe('16px')
        })

        test('applies custom border color', async ({ page, context }) => {
            const tour = createTour({
                id: 'custom-border',
                steps: [createStep({ contentHtml: '<p>Custom border</p>' })],
                appearance: { borderColor: '#ff00ff' },
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'custom-border')).toBeVisible({ timeout: 5000 })

            const borderColor = await page.evaluate(() => {
                const container = document.querySelector('[class*="ph-product-tour-container-custom-border"]')
                const tooltip = container?.shadowRoot?.querySelector('.ph-tour-tooltip') as HTMLElement
                return getComputedStyle(tooltip).borderColor
            })
            expect(borderColor).toBe('rgb(255, 0, 255)')
        })

        test('applies custom font family', async ({ page, context }) => {
            const tour = createTour({
                id: 'custom-font',
                steps: [createStep({ contentHtml: '<p>Custom font</p>' })],
                appearance: { fontFamily: 'Georgia, serif' },
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'custom-font')).toBeVisible({ timeout: 5000 })

            const fontFamily = await page.evaluate(() => {
                const container = document.querySelector('[class*="ph-product-tour-container-custom-font"]')
                const tooltip = container?.shadowRoot?.querySelector('.ph-tour-tooltip') as HTMLElement
                return getComputedStyle(tooltip).fontFamily
            })
            expect(fontFamily).toContain('Georgia')
        })

        test('applies custom box shadow', async ({ page, context }) => {
            const tour = createTour({
                id: 'custom-shadow',
                steps: [createStep({ contentHtml: '<p>Custom shadow</p>' })],
                appearance: { boxShadow: '0 0 20px red' },
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'custom-shadow')).toBeVisible({ timeout: 5000 })

            const boxShadow = await page.evaluate(() => {
                const container = document.querySelector('[class*="ph-product-tour-container-custom-shadow"]')
                const tooltip = container?.shadowRoot?.querySelector('.ph-tour-tooltip') as HTMLElement
                return getComputedStyle(tooltip).boxShadow
            })
            expect(boxShadow).toContain('rgb(255, 0, 0)')
        })
    })

    test.describe('step configuration', () => {
        test('applies custom maxWidth to tooltip', async ({ page, context }) => {
            const tour = createTour({
                id: 'custom-width',
                steps: [createStep({ contentHtml: '<p>Custom width</p>', maxWidth: 500 })],
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'custom-width')).toBeVisible({ timeout: 5000 })

            const maxWidth = await page.evaluate(() => {
                const container = document.querySelector('[class*="ph-product-tour-container-custom-width"]')
                const tooltip = container?.shadowRoot?.querySelector('.ph-tour-tooltip') as HTMLElement
                return getComputedStyle(tooltip).maxWidth
            })
            expect(maxWidth).toBe('500px')
        })

        test('custom button text and actions', async ({ page, context }) => {
            const tour = createTour({
                id: 'custom-buttons',
                steps: [
                    createStep({
                        contentHtml: '<p>Custom buttons</p>',
                        buttons: {
                            primary: { text: 'Continue', action: 'next_step' },
                            secondary: { text: 'Skip Tour', action: 'dismiss' },
                        },
                    }),
                    createStep({ contentHtml: '<p>Step 2</p>' }),
                ],
            })
            await startWithTours(page, context, [tour])

            const container = tourContainer(page, 'custom-buttons')
            await expect(tourTooltip(page, 'custom-buttons')).toBeVisible({ timeout: 5000 })

            await expect(container.locator('button:has-text("Continue")')).toBeVisible()
            await expect(container.locator('button:has-text("Skip Tour")')).toBeVisible()

            await container.locator('button:has-text("Continue")').click()
            await expect(container.locator('.ph-tour-content')).toContainText('Step 2')
        })

        test('secondary button with dismiss action closes tour', async ({ page, context }) => {
            const tour = createTour({
                id: 'dismiss-button',
                steps: [
                    createStep({
                        contentHtml: '<p>With dismiss button</p>',
                        buttons: {
                            primary: { text: 'Next', action: 'next_step' },
                            secondary: { text: 'Maybe Later', action: 'dismiss' },
                        },
                    }),
                    createStep({ contentHtml: '<p>Step 2</p>' }),
                ],
            })
            await startWithTours(page, context, [tour])

            const tooltip = tourTooltip(page, 'dismiss-button')
            await expect(tooltip).toBeVisible({ timeout: 5000 })

            await tourContainer(page, 'dismiss-button').locator('button:has-text("Maybe Later")').click()
            await expect(tooltip).not.toBeVisible()

            expect(
                await page.evaluate(() => localStorage.getItem('ph_product_tour_dismissed_dismiss-button'))
            ).toBeTruthy()
        })

        test('link button action opens URL', async ({ page, context }) => {
            const tour = createTour({
                id: 'link-button',
                steps: [
                    createStep({
                        contentHtml: '<p>With link button</p>',
                        buttons: {
                            primary: { text: 'Learn More', action: 'link', link: 'https://example.com/docs' },
                        },
                    }),
                ],
            })
            await startWithTours(page, context, [tour])

            await expect(tourTooltip(page, 'link-button')).toBeVisible({ timeout: 5000 })

            const href = await page.evaluate(() => {
                const container = document.querySelector('[class*="ph-product-tour-container-link-button"]')
                const link = container?.shadowRoot?.querySelector('a.ph-tour-button') as HTMLAnchorElement
                return link?.href
            })
            expect(href).toBe('https://example.com/docs')
        })

        test('previous_step button action goes back', async ({ page, context }) => {
            const tour = createTour({
                id: 'prev-button',
                steps: [
                    createStep({ contentHtml: '<p>Step 1</p>' }),
                    createStep({
                        contentHtml: '<p>Step 2</p>',
                        buttons: {
                            primary: { text: 'Continue', action: 'next_step' },
                            secondary: { text: 'Go Back', action: 'previous_step' },
                        },
                    }),
                    createStep({ contentHtml: '<p>Step 3</p>' }),
                ],
            })
            await startWithTours(page, context, [tour])

            const container = tourContainer(page, 'prev-button')
            await expect(tourTooltip(page, 'prev-button')).toBeVisible({ timeout: 5000 })

            await container.locator('button:has-text("Next")').click()
            await expect(container.locator('.ph-tour-content')).toContainText('Step 2')

            await container.locator('button:has-text("Go Back")').click()
            await expect(container.locator('.ph-tour-content')).toContainText('Step 1')
        })

        test('trigger_tour button action starts another tour', async ({ page, context }) => {
            const mainTour = createTour({
                id: 'main-tour',
                steps: [
                    createStep({
                        contentHtml: '<p>Main tour</p>',
                        buttons: {
                            primary: { text: 'Start Other Tour', action: 'trigger_tour', tourId: 'other-tour' },
                        },
                    }),
                ],
            })
            const otherTour = createTour({
                id: 'other-tour',
                auto_launch: false,
                steps: [createStep({ contentHtml: '<p>Other tour started!</p>' })],
            })
            await startWithTours(page, context, [mainTour, otherTour])

            await expect(tourTooltip(page, 'main-tour')).toBeVisible({ timeout: 5000 })

            await tourContainer(page, 'main-tour').locator('button:has-text("Start Other Tour")').click()

            await expect(tourTooltip(page, 'other-tour')).toBeVisible({ timeout: 5000 })
            await expect(tourContainer(page, 'other-tour').locator('.ph-tour-content')).toContainText(
                'Other tour started!'
            )
        })
    })

    test.describe('modal positioning', () => {
        const positions = [
            { position: SurveyPosition.TopLeft, expectedX: 'left', expectedY: 'top' },
            { position: SurveyPosition.TopCenter, expectedX: 'center', expectedY: 'top' },
            { position: SurveyPosition.TopRight, expectedX: 'right', expectedY: 'top' },
            { position: SurveyPosition.MiddleLeft, expectedX: 'left', expectedY: 'middle' },
            { position: SurveyPosition.MiddleCenter, expectedX: 'center', expectedY: 'middle' },
            { position: SurveyPosition.MiddleRight, expectedX: 'right', expectedY: 'middle' },
            { position: SurveyPosition.Left, expectedX: 'left', expectedY: 'bottom' },
            { position: SurveyPosition.Center, expectedX: 'center', expectedY: 'bottom' },
            { position: SurveyPosition.Right, expectedX: 'right', expectedY: 'bottom' },
        ] as const

        for (const { position, expectedX, expectedY } of positions) {
            test(`modal positioned at ${position}`, async ({ page, context }) => {
                const tour = createTour({
                    id: `modal-${position}`,
                    steps: [
                        createStep({ type: 'modal', contentHtml: '<p>Positioned modal</p>', modalPosition: position }),
                    ],
                })
                await startWithTours(page, context, [tour])

                await expect(tourTooltip(page, `modal-${position}`)).toBeVisible({ timeout: 5000 })

                const tooltipBox = await tourContainer(page, `modal-${position}`)
                    .locator('.ph-tour-tooltip')
                    .boundingBox()
                const viewport = page.viewportSize()

                expect(tooltipBox).toBeTruthy()
                expect(viewport).toBeTruthy()

                const tooltipCenterX = tooltipBox!.x + tooltipBox!.width / 2
                const tooltipCenterY = tooltipBox!.y + tooltipBox!.height / 2

                if (expectedX === 'left') {
                    expect(tooltipCenterX).toBeLessThan(viewport!.width / 3)
                } else if (expectedX === 'center') {
                    expect(Math.abs(tooltipCenterX - viewport!.width / 2)).toBeLessThan(100)
                } else if (expectedX === 'right') {
                    expect(tooltipCenterX).toBeGreaterThan((viewport!.width * 2) / 3)
                }

                if (expectedY === 'top') {
                    expect(tooltipCenterY).toBeLessThan(viewport!.height / 3)
                } else if (expectedY === 'middle') {
                    expect(Math.abs(tooltipCenterY - viewport!.height / 2)).toBeLessThan(100)
                } else if (expectedY === 'bottom') {
                    expect(tooltipCenterY).toBeGreaterThan((viewport!.height * 2) / 3)
                }
            })
        }
    })
})
