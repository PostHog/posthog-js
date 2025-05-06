import { getSurveyResponseKey } from '../../src/extensions/surveys/surveys-extension-utils'
import { pollUntilEventCaptured } from '../utils/event-capture-utils'
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
const singleChoiceQuestion = {
    type: 'single_choice',
    question: 'What is your occupation?',
    choices: ['Product Manager', 'Engineer', 'Designer', 'Other'],
    id: 'single_choice_1',
}
const appearanceWithThanks = {
    displayThankYouMessage: true,
    thankyouMessageHeader: 'Thanks!',
    thankyouMessageBody: 'We appreciate your feedback.',
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
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestion],
                            appearance: appearanceWithThanks,
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question')).toHaveText(
            'What feedback do you have for us?'
        )
        await expect(page.locator('.PostHogSurvey-123').locator('.survey-question-description')).toHaveText(
            'plain text description'
        )
        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('textarea').type('Great job!')
        await page.locator('.PostHogSurvey-123').locator('.form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
    })

    test('rating questions that are on the 10 scale start at 0', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [npsRatingQuestion, { ...npsRatingQuestion, scale: 5 }],
                            appearance: appearanceWithThanks,
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123').locator('.survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123').locator('.ratings-number')).toHaveCount(11)
        let i = 0
        for (const rating of await page.locator('.PostHogSurvey-123').locator('.ratings-number').all()) {
            await expect(rating).toBeVisible()
            await expect(rating).toHaveText(`${i++}`)
        }

        await page.locator('.PostHogSurvey-123').locator('.ratings-number').first().click()
        await page.locator('.PostHogSurvey-123').locator('.form-submit').click()

        await expect(page.locator('.PostHogSurvey-123').locator('.ratings-number').first()).toHaveText('1')
    })

    test('multiple question surveys', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '12345',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                multipleChoiceQuestion,
                                openTextQuestion,
                                { ...npsRatingQuestion, optional: true },
                            ],
                            appearance: appearanceWithThanks,
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-12345').locator('.survey-form')).toBeVisible()
        await page.locator('.PostHogSurvey-12345').locator('#surveyQuestion0Choice1').click()
        await page.locator('.PostHogSurvey-12345').locator('#surveyQuestion0Choice2').click()
        await page.locator('.PostHogSurvey-12345').locator('.form-submit').click()

        await page.locator('.PostHogSurvey-12345').locator('textarea').type('Great job!')
        await page.locator('.PostHogSurvey-12345').locator('.form-submit').click()
        await page.locator('.PostHogSurvey-12345').locator('.form-submit').click()

        await expect(page.locator('.PostHogSurvey-12345').locator('.thank-you-message')).toBeVisible()
        await page.locator('.PostHogSurvey-12345').locator('.form-submit').click()
        await expect(page.locator('.PostHogSurvey-12345').locator('.thank-you-message')).not.toBeVisible()

        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        expect(captures.map((c) => c.event)).toEqual([
            '$pageview',
            'survey shown',
            '$autocapture',
            '$autocapture',
            '$autocapture',
            '$autocapture',
            '$rageclick',
            '$autocapture',
            'survey sent',
            '$autocapture',
        ])
        const surveySent = captures.find((c) => c.event === 'survey sent')
        expect(surveySent!.properties[getSurveyResponseKey('multiple_choice_1')]).toEqual(['Product Updates', 'Events'])
        expect(surveySent!.properties['$survey_id']).toEqual('12345')
        expect(surveySent!.properties[getSurveyResponseKey('open_text_1')]).toEqual('Great job!')
        expect(surveySent!.properties[getSurveyResponseKey('nps_rating_1')]).toBeNull()
        expect(surveySent!.properties['$survey_questions']).toEqual([
            {
                id: 'multiple_choice_1',
                question: 'Which types of content would you like to see more of?',
            },
            {
                id: 'open_text_1',
                question: 'What feedback do you have for us?',
            },
            {
                id: 'nps_rating_1',
                question: 'Would you recommend surveys?',
            },
        ])
    })

    test('multiple choice questions with open choice', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '12345',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [{ ...multipleChoiceQuestion, hasOpenChoice: true }],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-12345').locator('.survey-form')).toBeVisible()
        await page.locator('.PostHogSurvey-12345').locator('#surveyQuestion0Choice3').click()
        await page.locator('.PostHogSurvey-12345').locator('#surveyQuestion0Choice0').click()
        await page.locator('.PostHogSurvey-12345').locator('input[type=text]').type('Newsletters')
        await page.locator('.PostHogSurvey-12345').locator('.form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        expect(captures.map((c) => c.event)).toEqual([
            '$pageview',
            'survey shown',
            '$autocapture',
            '$autocapture',
            '$autocapture',
            'survey sent',
        ])
        const surveySent = captures.find((c) => c.event === 'survey sent')
        expect(surveySent!.properties[getSurveyResponseKey('multiple_choice_1')]).toEqual(['Tutorials', 'Newsletters'])
        expect(surveySent!.properties['$survey_questions']).toEqual([
            {
                id: 'multiple_choice_1',
                question: 'Which types of content would you like to see more of?',
            },
        ])
    })

    test('single choice questions with open choice', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '12345',
                            name: 'single choice survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [{ ...singleChoiceQuestion, hasOpenChoice: true }],
                            appearance: { backgroundColor: 'black', submitButtonColor: 'white' },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-12345').locator('.survey-form')).toBeVisible()
        await page.locator('.PostHogSurvey-12345').locator('#surveyQuestion0Choice3').click()
        // TODO: you have to click on the input to activate it, really clicking on the parent should select the input
        await page.locator('.PostHogSurvey-12345').locator('#surveyQuestion0Choice3Open').click()
        await page
            .locator('.PostHogSurvey-12345')
            .locator('input[type=text]#surveyQuestion0Choice3Open')
            .type('Product engineer')

        await page.locator('.PostHogSurvey-12345').locator('.form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        expect(captures.map((c) => c.event)).toEqual([
            '$pageview',
            'survey shown',
            '$autocapture',
            '$autocapture',
            '$autocapture',
            'survey sent',
        ])
        const surveySent = captures.find((c) => c.event === 'survey sent')
        expect(surveySent!.properties[getSurveyResponseKey('single_choice_1')]).toEqual('Product engineer')
        expect(surveySent!.properties['$survey_questions']).toEqual([
            {
                id: 'single_choice_1',
                question: 'What is your occupation?',
            },
        ])
    })
})
