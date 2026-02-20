import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import {
    createTour,
    createStep,
    startOptionsWithProductTours,
    mockProductToursApi,
    tourTooltip,
    tourContainer,
    createElementStep,
    startWithTours,
    getSessionState,
    tourCompletedKey,
    tourDismissedKey,
    ACTIVE_TOUR_SESSION_KEY,
} from './utils'

const threeStepTour = createTour({
    id: 'nav-tour',
    steps: [
        createStep({ id: 'step-1', contentHtml: '<p>Step 1 content</p>' }),
        createStep({ id: 'step-2', contentHtml: '<p>Step 2 content</p>' }),
        createStep({ id: 'step-3', contentHtml: '<p>Step 3 content</p>' }),
    ],
})

test.describe('product tours - step navigation', () => {
    test.describe('core navigation', () => {
        test('navigates forward through steps with Next button', async ({ page, context }) => {
            await startWithTours(page, context, [threeStepTour])

            const container = tourContainer(page, 'nav-tour')
            await expect(tourTooltip(page, 'nav-tour')).toBeVisible({ timeout: 5000 })

            await expect(container.locator('.ph-tour-content')).toContainText('Step 1 content')
            expect((await getSessionState(page)).stepIndex).toBe(0)
            await container.locator('button:has-text("Next")').click()

            await expect(container.locator('.ph-tour-content')).toContainText('Step 2 content')
            expect((await getSessionState(page)).stepIndex).toBe(1)
            await container.locator('button:has-text("Next")').click()

            await expect(container.locator('.ph-tour-content')).toContainText('Step 3 content')
            expect((await getSessionState(page)).stepIndex).toBe(2)
            await expect(container.locator('button:has-text("Done")')).toBeVisible()
            await expect(container.locator('button:has-text("Next")')).not.toBeVisible()
        })

        test('navigates backward with Back button', async ({ page, context }) => {
            await startWithTours(page, context, [threeStepTour])

            const container = tourContainer(page, 'nav-tour')
            await expect(tourTooltip(page, 'nav-tour')).toBeVisible({ timeout: 5000 })

            await container.locator('button:has-text("Next")').click()
            await expect(container.locator('.ph-tour-content')).toContainText('Step 2 content')
            expect((await getSessionState(page)).stepIndex).toBe(1)

            await container.locator('button:has-text("Back")').click()
            await expect(container.locator('.ph-tour-content')).toContainText('Step 1 content')
            expect((await getSessionState(page)).stepIndex).toBe(0)

            await expect(container.locator('button:has-text("Back")')).not.toBeVisible()
        })

        test('completes tour on final step Done click', async ({ page, context }) => {
            await startWithTours(page, context, [threeStepTour])

            const container = tourContainer(page, 'nav-tour')
            const tooltip = tourTooltip(page, 'nav-tour')
            await expect(tooltip).toBeVisible({ timeout: 5000 })

            expect(await page.evaluate((key) => sessionStorage.getItem(key), ACTIVE_TOUR_SESSION_KEY)).toBeTruthy()

            await container.locator('button:has-text("Next")').click()
            await container.locator('button:has-text("Next")').click()

            await container.locator('button:has-text("Done")').click()
            await expect(tooltip).not.toBeVisible()

            expect(await page.evaluate((key) => localStorage.getItem(key), tourCompletedKey('nav-tour'))).toBeTruthy()
            expect(await page.evaluate((key) => sessionStorage.getItem(key), ACTIVE_TOUR_SESSION_KEY)).toBeFalsy()
        })

        test('dismissing mid-tour records dismissal', async ({ page, context }) => {
            await startWithTours(page, context, [threeStepTour])

            const container = tourContainer(page, 'nav-tour')
            const tooltip = tourTooltip(page, 'nav-tour')
            await expect(tooltip).toBeVisible({ timeout: 5000 })

            expect(await page.evaluate((key) => sessionStorage.getItem(key), ACTIVE_TOUR_SESSION_KEY)).toBeTruthy()

            await container.locator('button:has-text("Next")').click()
            await expect(container.locator('.ph-tour-content')).toContainText('Step 2 content')

            await container.locator('.ph-tour-dismiss').click()
            await expect(tooltip).not.toBeVisible()

            expect(await page.evaluate((key) => localStorage.getItem(key), tourDismissedKey('nav-tour'))).toBeTruthy()
            expect(await page.evaluate((key) => localStorage.getItem(key), tourCompletedKey('nav-tour'))).toBeFalsy()
            expect(await page.evaluate((key) => sessionStorage.getItem(key), ACTIVE_TOUR_SESSION_KEY)).toBeFalsy()
        })

        test('displays step counter', async ({ page, context }) => {
            await startWithTours(page, context, [threeStepTour])

            const container = tourContainer(page, 'nav-tour')
            await expect(tourTooltip(page, 'nav-tour')).toBeVisible({ timeout: 5000 })

            await expect(container.locator('.ph-tour-progress')).toContainText('1 of 3')

            await container.locator('button:has-text("Next")').click()
            await expect(container.locator('.ph-tour-progress')).toContainText('2 of 3')

            await container.locator('button:has-text("Next")').click()
            await expect(container.locator('.ph-tour-progress')).toContainText('3 of 3')
        })

        test('single step tour shows Done immediately', async ({ page, context }) => {
            const singleStepTour = createTour({
                id: 'single-step',
                steps: [createStep({ id: 'only-step', contentHtml: '<p>Only step</p>' })],
            })
            await startWithTours(page, context, [singleStepTour])

            const container = tourContainer(page, 'single-step')
            await expect(tourTooltip(page, 'single-step')).toBeVisible({ timeout: 5000 })

            await expect(container.locator('button:has-text("Done")')).toBeVisible()
            await expect(container.locator('button:has-text("Next")')).not.toBeVisible()
            await expect(container.locator('button:has-text("Back")')).not.toBeVisible()
        })
    })

    const elementStepVariants = [
        { label: 'element step (legacy)', asModal: false },
        { label: 'modal step with selector', asModal: true },
    ]

    for (const { label, asModal } of elementStepVariants) {
        test.describe(`multi-page navigation - ${label}`, () => {
            test('tour resumes after navigating to new page', async ({ page, context }) => {
                const tour = createTour({
                    id: 'multi-page-tour',
                    steps: [
                        createElementStep(
                            '#nav-link',
                            {
                                id: 'step-1',
                                progressionTrigger: 'click',
                                contentHtml: '<p>Click this link to continue</p>',
                            },
                            asModal
                        ),
                        createElementStep(
                            '#page2-target',
                            {
                                id: 'step-2',
                                progressionTrigger: 'button',
                                contentHtml: '<p>Welcome to page 2!</p>',
                            },
                            asModal
                        ),
                    ],
                })

                await startWithTours(page, context, [tour])

                await expect(tourTooltip(page, 'multi-page-tour')).toBeVisible({ timeout: 5000 })
                await expect(tourContainer(page, 'multi-page-tour').locator('.ph-tour-content')).toContainText(
                    'Click this link'
                )

                const sessionState = await getSessionState(page)
                expect(sessionState.tourId).toBe('multi-page-tour')
                expect(sessionState.stepIndex).toBe(0)

                await tourContainer(page, 'multi-page-tour').locator('.ph-tour-spotlight').click()

                await page.waitForURL('**/page2.html')

                await start(
                    { ...startOptionsWithProductTours, type: 'reload', url: './playground/cypress/page2.html' },
                    page,
                    context
                )
                await mockProductToursApi(page, [tour])

                await expect(tourTooltip(page, 'multi-page-tour')).toBeVisible({ timeout: 5000 })
                await expect(tourContainer(page, 'multi-page-tour').locator('.ph-tour-content')).toContainText(
                    'Welcome to page 2'
                )

                const newSessionState = await getSessionState(page)
                expect(newSessionState.stepIndex).toBe(1)
            })
        })
    }
})
