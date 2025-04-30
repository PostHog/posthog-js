import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {},
    decideResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

const openTextQuestion = {
    type: 'open',
    question: 'What feedback do you have for us?',
    description: 'plain text description',
    id: 'open_text_1',
}

test.describe('surveys - core display logic', () => {
    test('shows the same to user if they do not dismiss or respond to it', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            description: 'description',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()

        await page.reload()

        await start({ ...startOptions, type: 'reload' }, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
    })

    test('does not show the same survey to user if they have dismissed it before', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            description: 'description',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await page.locator('.PostHogSurvey-123').locator('.cancel-btn-wrapper').click()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).not.toBeInViewport()

        expect(
            await page.evaluate(() => {
                return window.localStorage.getItem('seenSurvey_123')
            })
        ).toBeTruthy()

        await page.reload()

        await start({ ...startOptions, type: 'reload' }, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).not.toBeInViewport()
    })

    test('does not show the same survey to user if they responded to it before', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            description: 'description',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await page.locator('.PostHogSurvey-123').locator('textarea').type('some feedback')
        await page.locator('.PostHogSurvey-123').locator('.form-submit').click()

        expect(
            await page.evaluate(() => {
                return window.localStorage.getItem('seenSurvey_123')
            })
        ).toBeTruthy()

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).not.toBeInViewport()

        await page.reload()

        await start({ ...startOptions, type: 'reload' }, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).not.toBeInViewport()

        expect(
            await page.evaluate(() => {
                return window.localStorage.getItem('seenSurvey_123')
            })
        ).toBeTruthy()
    })

    test('does not show a survey to user if user has already seen any survey in the wait period', async ({
        page,
        context,
    }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            description: 'description',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            conditions: { seenSurveyWaitPeriodInDays: 10 },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()

        const lastSeenDate = await page.evaluate(() => {
            return window.localStorage.getItem('lastSeenSurveyDate')
        })

        expect(lastSeenDate!.split('T')[0]).toEqual(new Date().toISOString().split('T')[0])

        await page.reload()

        await start({ ...startOptions, type: 'reload' }, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).not.toBeInViewport()
    })

    test('does not allow user to submit non optional survey questions if they have not responded to it', async ({
        page,
        context,
    }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            description: 'description',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [{ ...openTextQuestion, optional: false }],
                            appearance: { submitButtonColor: 'pink' },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.form-submit')).toHaveAttribute('disabled')
        await page.locator('.PostHogSurvey-123').locator('textarea').type('some feedback')
        await expect(page.locator('.PostHogSurvey-123').locator('.form-submit')).not.toHaveAttribute('disabled')
    })
})
