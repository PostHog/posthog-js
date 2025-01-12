import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { pollUntilEventCaptured } from '../utils/event-capture-utils'

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
}

const npsRatingQuestion = { type: 'rating', display: 'number', scale: 10, question: 'Would you recommend surveys?' }

const multipleChoiceQuestion = {
    type: 'multiple_choice',
    question: 'Which types of content would you like to see more of?',
    choices: ['Tutorials', 'Product Updates', 'Events', 'Other'],
}

const appearanceWithThanks = {
    displayThankYouMessage: true,
    thankyouMessageHeader: 'Thanks!',
    thankyouMessageBody: 'We appreciate your feedback.',
}

const black = 'rgb(0, 0, 0)'
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

        await expect(page.locator('.PostHogWidget123').locator('.survey-form')).not.toBeVisible()
        await page.locator('.PostHogWidget123').locator('.ph-survey-widget-tab').click()
        await expect(page.locator('.PostHogWidget123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogWidget123').locator('.survey-question')).toHaveText('Feedback for us?')
        await expect(page.locator('.PostHogWidget123').locator('.survey-question-description')).toHaveText(
            'tab feedback widget'
        )

        await page.locator('.PostHogWidget123').locator('.survey-form').locator('textarea').fill('hello posthog!')
        await page.locator('.PostHogWidget123').locator('.survey-form').locator('.form-submit').click()
        await pollUntilEventCaptured(page, 'survey sent')
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
                                { type: 'open', question: 'Feedback for us?', description: 'custom selector widget' },
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

        await expect(page.locator('.PostHogWidget123').locator('.ph-survey-widget-tab')).not.toBeVisible()
        await page.locator('.test-surveys').click()

        await expect(page.locator('.PostHogWidget123').locator('.survey-form')).toBeVisible({ timeout: 8000 })

        await expect(page.locator('.PostHogWidget123').locator('.survey-question')).toHaveText('Feedback for us?')
        await expect(page.locator('.PostHogWidget123').locator('.survey-question-description')).toHaveText(
            'custom selector widget'
        )

        await page.locator('.PostHogWidget123').locator('.survey-form').locator('textarea').fill('hello posthog!')
        await page.locator('.PostHogWidget123').locator('.survey-form').locator('.form-submit').click()
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

        await page.locator('.PostHogWidget123').locator('.ph-survey-widget-tab').click()
        await expect(page.locator('.PostHogWidget123').locator('.survey-form')).toBeVisible()

        await page.locator('.PostHogWidget123').locator('#surveyQuestion0Choice1').click()
        await page.locator('.PostHogWidget123').locator('.survey-form').locator('.form-submit').click()

        await page.locator('.PostHogWidget123 textarea').first().type('Because I want to learn more about posthog')
        await page.locator('.PostHogWidget123 .form-submit').click()
        await page.locator('.PostHogWidget123 .form-submit').click()

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

        await expect(page.locator('.PostHogWidget123').locator('.ph-survey-widget-tab')).toBeVisible()

        await expect(page.locator('.PostHogWidget123').locator('.ph-survey-widget-tab')).toHaveCSS('color', black)
        await expect(page.locator('.PostHogWidget123').locator('.ph-survey-widget-tab')).toHaveCSS(
            'background-color',
            white
        )
    })
})
