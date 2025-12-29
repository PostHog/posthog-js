import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {},
    flagsResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

const appearanceWithThanks = {
    displayThankYouMessage: true,
    thankYouMessageHeader: 'Thanks!',
}

test.describe('survey validation', () => {
    test('required field rejects whitespace-only input', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'validation-test-1',
                            name: 'Required field test',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'open',
                                    question: 'Required feedback',
                                    id: 'q1',
                                    optional: false,
                                },
                            ],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        // Wait for survey form to appear
        await expect(page.locator('.PostHogSurvey-validation-test-1').locator('.survey-form')).toBeVisible()

        // Type only spaces
        await page.locator('textarea').fill('   ')

        // Submit button should be disabled (validation failed - whitespace only)
        await expect(page.locator('button:has-text("Submit")')).toBeDisabled()

        // Survey form should still be visible
        await expect(page.locator('.PostHogSurvey-validation-test-1').locator('.survey-form')).toBeVisible()
    })

    test('required field accepts valid input after trim', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'validation-test-2',
                            name: 'Valid input test',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'open',
                                    question: 'Required feedback',
                                    id: 'q1',
                                    optional: false,
                                },
                            ],
                            appearance: appearanceWithThanks,
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall
        await expect(page.locator('.PostHogSurvey-validation-test-2').locator('.survey-form')).toBeVisible()

        // Type valid content with surrounding whitespace
        await page.locator('textarea').fill('  valid response  ')
        await page.locator('button:has-text("Submit")').click()

        // Should show thank you message (submitted successfully)
        await expect(page.locator('.PostHogSurvey-validation-test-2')).toContainText('Thanks')
    })

    test('backwards compat - old survey without validation field works', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'validation-test-3',
                            name: 'Old survey format',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'open',
                                    question: 'Old question format',
                                    id: 'q1',
                                    // No 'validation' field - old survey format
                                    // No 'optional' field - defaults to required
                                },
                            ],
                            appearance: appearanceWithThanks,
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall
        await expect(page.locator('.PostHogSurvey-validation-test-3').locator('.survey-form')).toBeVisible()

        await page.locator('textarea').fill('valid response')
        await page.locator('button:has-text("Submit")').click()

        // Should show thank you message (submitted successfully)
        await expect(page.locator('.PostHogSurvey-validation-test-3')).toContainText('Thanks')
    })

    test('minLength validation prevents short input', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'validation-test-4',
                            name: 'MinLength test',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'open',
                                    question: 'Enter at least 10 characters',
                                    id: 'q1',
                                    optional: false,
                                    validation: [{ type: 'min_length', value: 10 }],
                                },
                            ],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall
        await expect(page.locator('.PostHogSurvey-validation-test-4').locator('.survey-form')).toBeVisible()

        await page.locator('textarea').fill('short')

        // Submit button should be disabled (validation failed - too short)
        await expect(page.locator('button:has-text("Submit")')).toBeDisabled()

        // Survey form should still be visible
        await expect(page.locator('.PostHogSurvey-validation-test-4').locator('.survey-form')).toBeVisible()
    })

    test('email validation rejects invalid email', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'validation-test-5',
                            name: 'Email test',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'open',
                                    question: 'Enter your email',
                                    id: 'q1',
                                    optional: false,
                                    validation: [{ type: 'email' }],
                                },
                            ],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall
        await expect(page.locator('.PostHogSurvey-validation-test-5').locator('.survey-form')).toBeVisible()

        await page.locator('textarea').fill('notanemail')

        // Submit button should be disabled (validation failed - invalid email)
        await expect(page.locator('button:has-text("Submit")')).toBeDisabled()

        // Survey form should still be visible
        await expect(page.locator('.PostHogSurvey-validation-test-5').locator('.survey-form')).toBeVisible()
    })

    test('email validation accepts valid email', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'validation-test-6',
                            name: 'Email valid test',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'open',
                                    question: 'Enter your email',
                                    id: 'q1',
                                    optional: false,
                                    validation: [{ type: 'email' }],
                                },
                            ],
                            appearance: appearanceWithThanks,
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall
        await expect(page.locator('.PostHogSurvey-validation-test-6').locator('.survey-form')).toBeVisible()

        await page.locator('textarea').fill('test@example.com')
        await page.locator('button:has-text("Submit")').click()

        // Should show thank you message (submitted successfully)
        await expect(page.locator('.PostHogSurvey-validation-test-6')).toContainText('Thanks')
    })
})
