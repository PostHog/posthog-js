import { SurveyType } from '@posthog/core'
import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const openTextQuestion = {
    type: 'open',
    question: 'What feedback do you have for us?',
    description: 'Please provide your feedback',
    id: 'open_text_1',
}

const ratingQuestion = {
    type: 'rating',
    question: 'How would you rate your experience?',
    description: 'Rate us from 1 to 5',
    id: 'rating_1',
    scale: 5,
}

const testSurvey = {
    id: 'test-survey-123',
    name: 'Test On-Demand Survey',
    description: 'A survey rendered on demand',
    type: 'popover',
    start_date: '2021-01-01T00:00:00Z',
    questions: [openTextQuestion],
}

const testSurveyWithDelay = {
    id: 'test-survey-delay',
    name: 'Test Survey With Delay',
    description: 'A survey with popup delay',
    type: 'popover',
    start_date: '2021-01-01T00:00:00Z',
    questions: [ratingQuestion],
    appearance: {
        surveyPopupDelaySeconds: 3,
    },
}

const startOptions = {
    options: {
        disable_surveys_automatic_display: true,
    },
    flagsResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('surveys - displaySurvey on demand', () => {
    test('displaySurvey shows a survey popup when called with valid survey ID', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [testSurvey],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        // Survey should not be visible initially
        await expect(page.locator('.PostHogSurvey-test-survey-123').locator('.survey-form')).not.toBeInViewport()

        // Call displaySurvey programmatically
        await page.evaluate(() => {
            // @ts-expect-error - posthog is added to window in test setup
            window.posthog.onSurveysLoaded(() => {
                // @ts-expect-error - posthog is added to window in test setup
                window.posthog.displaySurvey('test-survey-123')
            })
        })

        // Survey should now be visible
        await expect(page.locator('.PostHogSurvey-test-survey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-test-survey-123').locator('.survey-question')).toHaveText(
            'What feedback do you have for us?'
        )
        await expect(page.locator('.PostHogSurvey-test-survey-123').locator('.survey-question-description')).toHaveText(
            'Please provide your feedback'
        )
    })

    test('displaySurvey shows a survey inline when called with valid survey ID', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [testSurvey],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        // Survey should not be visible initially
        await expect(page.locator('#survey').locator('.survey-form')).not.toBeInViewport()

        // Call displaySurvey programmatically
        await page.evaluate(() => {
            // @ts-expect-error - posthog is added to window in test setup
            window.posthog.onSurveysLoaded(() => {
                // @ts-expect-error - posthog is added to window in test setup
                window.posthog.displaySurvey('test-survey-123', {
                    displayType: 'inline',
                    selector: '#survey',
                })
            })
        })

        // Survey should now be visible
        await expect(page.locator('#survey').locator('.survey-form')).toBeVisible()
        await expect(page.locator('#survey').locator('.survey-question')).toHaveText(
            'What feedback do you have for us?'
        )
        await expect(page.locator('#survey').locator('.survey-question-description')).toHaveText(
            'Please provide your feedback'
        )
    })

    test('displaySurvey shows a survey inline when called with valid survey ID with delay', async ({
        page,
        context,
    }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [testSurveyWithDelay],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        // Survey should not be visible initially, but playwright has 10 second timeout
        await expect(page.locator('#survey').locator('.survey-form')).not.toBeInViewport()

        // Call displaySurvey programmat ically
        await page.evaluate(() => {
            // @ts-expect-error - posthog is added to window in test setup
            window.posthog.onSurveysLoaded(() => {
                // @ts-expect-error - posthog is added to window in test setup
                window.posthog.displaySurvey('test-survey-delay', {
                    displayType: 'inline',
                    selector: '#survey',
                    ignoreDelay: true,
                })
            })
        })

        await expect(page.locator('#survey').locator('.survey-form')).toBeVisible()
    })

    test('displaySurvey ignores survey popup delay when rendering on demand', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [testSurveyWithDelay],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        // Survey should not be visible initially
        await expect(page.locator('.PostHogSurvey-test-survey-delay').locator('.survey-form')).not.toBeInViewport()

        // Call displaySurvey programmatically
        await page.evaluate(() => {
            // @ts-expect-error - posthog is added to window in test setup
            window.posthog.onSurveysLoaded(() => {
                // @ts-expect-error - posthog is added to window in test setup
                window.posthog.displaySurvey('test-survey-delay', {
                    displayType: 'popover',
                    ignoreConditions: true,
                    ignoreDelay: true,
                })
            })
        })

        // Survey should be visible immediately (ignoring the 3-second delay)
        await expect(page.locator('.PostHogSurvey-test-survey-delay').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-test-survey-delay').locator('.survey-question')).toHaveText(
            'How would you rate your experience?'
        )
    })

    test('displaySurvey doesnt ignore delay when the proper option is passed', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [testSurveyWithDelay],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        // Survey should not be visible initially
        await expect(page.locator('.PostHogSurvey-test-survey-delay').locator('.survey-form')).not.toBeInViewport()

        // Call displaySurvey programmatically
        await page.evaluate(() => {
            // @ts-expect-error - posthog is added to window in test setup
            window.posthog.onSurveysLoaded(() => {
                // @ts-expect-error - posthog is added to window in test setup
                window.posthog.displaySurvey('test-survey-delay', {
                    displayType: 'popover',
                    ignoreConditions: true,
                })
            })
        })

        // Survey should be visible at some point (Playwright by default has a 10 second timeout)
        await expect(page.locator('.PostHogSurvey-test-survey-delay').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-test-survey-delay').locator('.survey-question')).toHaveText(
            'How would you rate your experience?'
        )
    })

    test('displaySurvey handles invalid survey ID gracefully', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [testSurvey],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        // Call displaySurvey with invalid survey ID
        await page.evaluate(() => {
            // @ts-expect-error - posthog is added to window in test setup
            window.posthog.displaySurvey('non-existent-survey')
        })

        // No survey should be visible
        await expect(page.locator('.PostHogSurvey-non-existent-survey')).not.toBeVisible()
        await expect(page.locator('.PostHogSurvey-test-survey-123')).not.toBeVisible()
    })

    Object.values(SurveyType)
        .filter((type) => type !== SurveyType.ExternalSurvey)
        .forEach((surveyType: string) => {
            test(`displaySurvey can be called with popover displayType multiple times for the same ${surveyType} survey`, async ({
                page,
                context,
            }) => {
                const surveysAPICall = page.route('**/surveys/**', async (route) => {
                    await route.fulfill({
                        json: {
                            surveys: [{ ...testSurvey, type: surveyType }],
                        },
                    })
                })

                await start(startOptions, page, context)
                await surveysAPICall

                // Call displaySurvey first time
                await page.evaluate(() => {
                    // @ts-expect-error - posthog is added to window in test setup
                    window.posthog.onSurveysLoaded(() => {
                        // @ts-expect-error - posthog is added to window in test setup
                        window.posthog.displaySurvey('test-survey-123')
                    })
                })

                // Survey should be visible
                await expect(page.locator('.PostHogSurvey-test-survey-123').locator('.survey-form')).toBeVisible()

                // Dismiss the survey
                await page.locator('.PostHogSurvey-test-survey-123').locator('.form-cancel').click()
                await expect(
                    page.locator('.PostHogSurvey-test-survey-123').locator('.survey-form')
                ).not.toBeInViewport()

                // Wait for 1 second so survey is dismissed internally
                await page.waitForTimeout(1000)

                // Call displaySurvey again
                await page.evaluate(() => {
                    // @ts-expect-error - posthog is added to window in test setup
                    window.posthog.displaySurvey('test-survey-123', {
                        displayType: 'popover',
                        ignoreConditions: true,
                    })
                })

                // Survey should be visible again (ignoring normal dismissal logic)
                await expect(page.locator('.PostHogSurvey-test-survey-123').locator('.survey-form')).toBeVisible()
            })
        })

    test('displaySurvey fails gracefully when surveys are not initialized', async ({ page, context }) => {
        // Start without surveys enabled
        await start(
            {
                options: {},
                flagsResponseOverrides: {
                    surveys: false, // Disable surveys
                },
                url: './playground/cypress/index.html',
            },
            page,
            context
        )

        // Call displaySurvey when surveys are not initialized
        await page.evaluate(() => {
            // @ts-expect-error - posthog is added to window in test setup
            window.posthog.displaySurvey('test-survey-123')
        })

        // No survey should be visible
        await expect(page.locator('.PostHogSurvey-test-survey-123')).not.toBeVisible()
    })

    test('displaySurvey can render multiple different surveys', async ({ page, context }) => {
        const survey1 = {
            ...testSurvey,
            id: 'survey-1',
            name: 'First Survey',
        }

        const survey2 = {
            ...testSurvey,
            id: 'survey-2',
            name: 'Second Survey',
            questions: [ratingQuestion],
        }

        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [survey1, survey2],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        // Call displaySurvey for first survey
        await page.evaluate(() => {
            // @ts-expect-error - posthog is added to window in test setup
            window.posthog.onSurveysLoaded(() => {
                // @ts-expect-error - posthog is added to window in test setup
                window.posthog.displaySurvey('survey-1')
            })
        })

        // First survey should be visible
        await expect(page.locator('.PostHogSurvey-survey-1').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-survey-1').locator('.survey-question')).toHaveText(
            'What feedback do you have for us?'
        )

        // Close first survey
        await page.locator('.PostHogSurvey-survey-1').locator('.form-cancel').click()

        // Call displaySurvey for second survey
        await page.evaluate(() => {
            // @ts-expect-error - posthog is added to window in test setup
            window.posthog.displaySurvey('survey-2')
        })

        // Second survey should be visible
        await expect(page.locator('.PostHogSurvey-survey-2').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-survey-2').locator('.survey-question')).toHaveText(
            'How would you rate your experience?'
        )
    })
})
