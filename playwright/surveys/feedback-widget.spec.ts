import { SurveySchedule } from '../../src/posthog-surveys-types'
import { pollUntilEventCaptured } from '../utils/event-capture-utils'
import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

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
    description: 'plain text description',
    id: 'open_text_1',
}

const npsRatingQuestion = {
    type: 'rating',
    display: 'number',
    scale: 10,
    question: 'Would you recommend surveys?',
    id: 'nps_rating_1',
}

const multipleChoiceQuestion = {
    type: 'multiple_choice',
    question: 'Which types of content would you like to see more of?',
    choices: ['Tutorials', 'Product Updates', 'Events', 'Other'],
    id: 'multiple_choice_1',
}

const appearanceWithThanks = {
    displayThankYouMessage: true,
    thankyouMessageHeader: 'Thanks!',
    thankyouMessageBody: 'We appreciate your feedback.',
}

const black = 'rgb(2, 6, 23)'
const white = 'rgb(255, 255, 255)'

test.describe('surveys - feedback widget', () => {
    test('displays feedback tab and submits responses ', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'widget',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'open',
                                    question: 'Feedback for us?',
                                    description: 'tab feedback widget',
                                    id: 'feedback_tab_1',
                                },
                            ],
                            appearance: {
                                widgetLabel: 'Feedback',
                                widgetType: 'tab',
                                displayThankYouMessage: true,
                                thankyouMessageHeader: 'Thanks!',
                                thankyouMessageBody: 'We appreciate your feedback.',
                            },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).not.toBeVisible()
        await page.locator('.PostHogSurvey-123').locator('.ph-survey-widget-tab').click()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question')).toHaveText('Feedback for us?')
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question-description')).toHaveText(
            'tab feedback widget'
        )

        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('textarea').fill('hello posthog!')
        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('.form-submit').click()
        await pollUntilEventCaptured(page, 'survey sent')
    })

    test('displays feedback tab in a responsive manner ', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'widget',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                { type: 'open', question: 'Feedback for us?', description: 'tab feedback widget' },
                            ],
                            appearance: {
                                widgetLabel: 'Feedback',
                                widgetType: 'tab',
                                displayThankYouMessage: true,
                                thankyouMessageHeader: 'Thanks!',
                                thankyouMessageBody: 'We appreciate your feedback.',
                            },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await page.locator('.PostHogSurvey-123').locator('.ph-survey-widget-tab').click()
        await page.setViewportSize({ width: 375, height: 667 })

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeInViewport()
    })

    test('widgetType is custom selector', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'widget',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'open',
                                    question: 'Feedback for us?',
                                    description: 'custom selector widget',
                                    id: 'custom_selector_1',
                                },
                            ],
                            appearance: {
                                widgetType: 'selector',
                                widgetSelector: '.test-surveys',
                                displayThankYouMessage: true,
                                thankyouMessageHeader: 'Thanks!',
                                thankyouMessageBody: 'We appreciate your feedback.',
                            },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.ph-survey-widget-tab')).not.toBeVisible()
        await page.locator('.test-surveys').click()

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible({ timeout: 8000 })

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question')).toHaveText('Feedback for us?')
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question-description')).toHaveText(
            'custom selector widget'
        )

        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('textarea').fill('hello posthog!')
        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('.form-submit').click()
        await pollUntilEventCaptured(page, 'survey sent')
    })

    test('displays multiple question surveys and thank you confirmation if enabled', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'widget',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                multipleChoiceQuestion,
                                openTextQuestion,
                                { ...npsRatingQuestion, optional: true },
                            ],
                            appearance: { ...appearanceWithThanks, widgetType: 'tab', widgetLabel: 'Feedback :)' },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await page.locator('.PostHogSurvey-123').locator('.ph-survey-widget-tab').click()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()

        await page.locator('.PostHogSurvey-123').locator('#surveyQuestion0Choice1').click()
        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('.form-submit').click()

        await page.locator('.PostHogSurvey-123 textarea').first().type('Because I want to learn more about posthog')
        await page.locator('.PostHogSurvey-123 .form-submit').click()
        await page.locator('.PostHogSurvey-123 .form-submit').click()

        await pollUntilEventCaptured(page, 'survey shown')
        await pollUntilEventCaptured(page, 'survey sent')
    })

    test('auto contrasts text color for feedback tab', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'widget',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            appearance: {
                                widgetLabel: 'white widget',
                                widgetType: 'tab',
                                widgetColor: 'white',
                            },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.ph-survey-widget-tab')).toBeVisible()

        await expect(page.locator('.PostHogSurvey-123').locator('.ph-survey-widget-tab')).toHaveCSS('color', black)
        await expect(page.locator('.PostHogSurvey-123').locator('.ph-survey-widget-tab')).toHaveCSS(
            'background-color',
            white
        )
    })

    test('renders survey with schedule always and allows multiple submissions', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'widget',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            appearance: {
                                widgetLabel: 'Feedback',
                                widgetType: 'tab',
                                displayThankYouMessage: true,
                                thankyouMessageHeader: 'Thank you!',
                            },
                            conditions: {
                                url: null,
                                selector: null,
                                scrolled: null,
                            },
                            schedule: SurveySchedule.Always,
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        // 1. Check that the survey widget is rendered
        await expect(page.locator('.PostHogSurvey-123').locator('.ph-survey-widget-tab')).toBeVisible()

        // 2. Open the survey
        await page.locator('.PostHogSurvey-123').locator('.ph-survey-widget-tab').click()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()

        // 3. Answer the survey
        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('textarea').fill('first submission')
        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('.form-submit').click()

        // 4. Check for thank you message
        await expect(page.locator('.PostHogSurvey-123').locator('.thank-you-message-header')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.thank-you-message-header')).toHaveText('Thank you!')

        // Verify the event was sent
        await pollUntilEventCaptured(page, 'survey sent')

        // 5. Close the thank you message and click the survey tab again
        await page.locator('.PostHogSurvey-123').locator('.form-submit').click()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).not.toBeVisible()
        await page.waitForTimeout(300)

        // Open the survey again
        await page.locator('.PostHogSurvey-123').locator('.ph-survey-widget-tab').click()

        // 6. Verify survey is rendered again
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()

        // Submit again with different text
        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('textarea').fill('second submission')
        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('.form-submit').click()

        // Verify thank you message appears again
        await expect(page.locator('.PostHogSurvey-123').locator('.thank-you-message-header')).toBeVisible()

        // Verify second event was sent
        await pollUntilEventCaptured(page, 'survey sent')
    })

    test('if multiple surveys being shown, sending one of them does not close the other one', async ({
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
                            type: 'widget',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            appearance: {
                                widgetLabel: 'Feedback',
                                widgetType: 'tab',
                                displayThankYouMessage: true,
                                thankyouMessageHeader: 'Thank you!',
                            },
                        },
                        {
                            id: '456',
                            name: 'Test survey 2',
                            type: 'widget',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            appearance: {
                                position: 'next_to_trigger',
                                widgetSelector: '.test-surveys',
                                widgetType: 'selector',
                                displayThankYouMessage: true,
                                thankyouMessageHeader: 'Thank you!',
                            },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        // click on the second survey trigger
        await page.locator('.test-surveys').click()
        await expect(page.locator('.PostHogSurvey-456').locator('.survey-form')).toBeVisible()

        await page.locator('.PostHogSurvey-123').locator('.ph-survey-widget-tab').click()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()

        // fill in first survey
        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('textarea').fill('first submission')
        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('.form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')

        // click on the first survey confirmation message
        await page.locator('.PostHogSurvey-123').locator('.form-submit').click()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).not.toBeVisible()

        // check if the second survey is still visible
        await expect(page.locator('.PostHogSurvey-456').locator('.survey-form')).toBeVisible()
    })

    test('if multiple surveys being shown, closing one does not close the other', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'widget',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            appearance: {
                                widgetLabel: 'Feedback',
                                widgetType: 'tab',
                                displayThankYouMessage: true,
                                thankyouMessageHeader: 'Thank you!',
                            },
                        },
                        {
                            id: '456',
                            name: 'Test survey 2',
                            type: 'widget',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            appearance: {
                                position: 'next_to_trigger',
                                widgetSelector: '.test-surveys',
                                widgetType: 'selector',
                                displayThankYouMessage: true,
                                thankyouMessageHeader: 'Thank you!',
                            },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        // click on the second survey trigger
        await page.locator('.test-surveys').click()
        await expect(page.locator('.PostHogSurvey-456').locator('.survey-form')).toBeVisible()

        await page.locator('.PostHogSurvey-123').locator('.ph-survey-widget-tab').click()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()

        // close first survey
        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('.form-cancel').click()

        await pollUntilEventCaptured(page, 'survey dismissed')

        // check if the second survey is still visible
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).not.toBeVisible()
    })
})
