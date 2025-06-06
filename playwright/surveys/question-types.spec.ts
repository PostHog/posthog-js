import { getSurveyResponseKey } from '../../src/extensions/surveys/surveys-extension-utils'
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
const singleChoiceQuestion = {
    type: 'single_choice',
    question: 'What is your occupation?',
    choices: ['Product Manager', 'Engineer', 'Designer', 'Other'],
    id: 'single_choice_1',
}

const emojiRatingSkipButtonQuestion = {
    type: 'rating' as const,
    display: 'emoji' as const,
    scale: 3,
    question: 'Rate your mood (emoji, skip)',
    id: 'emoji_rating_skip_1',
    skipSubmitButton: true,
}

const numberRatingSkipButtonQuestion = {
    type: 'rating' as const,
    display: 'number' as const,
    scale: 5,
    question: 'Rate your experience (number, skip)',
    id: 'number_rating_skip_1',
    skipSubmitButton: true,
}

const singleChoiceSkipButtonQuestion = {
    type: 'single_choice' as const,
    question: 'Your favorite season (skip)?',
    choices: ['Spring', 'Summer', 'Autumn', 'Winter'],
    hasOpenChoice: false,
    id: 'single_choice_skip_1',
    skipSubmitButton: true,
}

const appearanceWithThanks = {
    displayThankYouMessage: true,
    thankYouMessageHeader: 'Thanks!',
    thankYouMessageBody: 'We appreciate your feedback.',
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
        await page.locator('.PostHogSurvey-123').locator('.survey-form').locator('textarea').fill('Great job!')
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

        await expect(page.locator('.PostHogSurvey-123').locator('.ratings-number').first()).toHaveText('0')
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

        await page.locator('.PostHogSurvey-12345').locator('textarea').fill('Great job!')
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
        expect(surveySent!.properties[getSurveyResponseKey('multiple_choice_1')]).toEqual(
            expect.arrayContaining(['Product Updates', 'Events'])
        )
        expect(surveySent!.properties['$survey_id']).toEqual('12345')
        expect(surveySent!.properties[getSurveyResponseKey('open_text_1')]).toEqual('Great job!')
        expect(surveySent!.properties[getSurveyResponseKey('nps_rating_1')]).toBeNull()
        expect(surveySent!.properties['$survey_questions']).toEqual([
            {
                id: 'multiple_choice_1',
                question: 'Which types of content would you like to see more of?',
                response: ['Product Updates', 'Events'],
            },
            {
                id: 'open_text_1',
                question: 'What feedback do you have for us?',
                response: 'Great job!',
            },
            {
                id: 'nps_rating_1',
                question: 'Would you recommend surveys?',
                response: null,
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
                response: ['Tutorials', 'Newsletters'],
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
                response: 'Product engineer',
            },
        ])
    })
})

test.describe('surveys - skipSubmitButton functionality', () => {
    test('handles questions with skipSubmitButton correctly and sends event', async ({ page, context }) => {
        const surveyId = 'skip_button_survey_123'
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: surveyId,
                            name: 'Test Skip Submit Button Survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                emojiRatingSkipButtonQuestion,
                                numberRatingSkipButtonQuestion,
                                singleChoiceSkipButtonQuestion,
                            ],
                            appearance: appearanceWithThanks,
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        const surveyLocator = page.locator(`.PostHogSurvey-${surveyId}`)

        // Question 1: Emoji Rating
        await expect(surveyLocator.locator('.survey-question')).toHaveText(emojiRatingSkipButtonQuestion.question)
        await expect(surveyLocator.locator('.form-submit')).not.toBeVisible()
        await surveyLocator.locator('button[aria-label="Rate 2"]').click() // Click 2nd emoji (value 2 for scale 3)

        // Question 2: Number Rating (should appear automatically)
        await expect(surveyLocator.locator('.survey-question')).toHaveText(numberRatingSkipButtonQuestion.question)
        await expect(surveyLocator.locator('.form-submit')).not.toBeVisible()
        await surveyLocator.locator('button[aria-label="Rate 4"]').click() // Click rating 4 for scale 5

        // Question 3: Single Choice (should appear automatically)
        await expect(surveyLocator.locator('.survey-question')).toHaveText(singleChoiceSkipButtonQuestion.question)
        await expect(surveyLocator.locator('.form-submit')).not.toBeVisible()
        await surveyLocator.locator('label:has-text("Summer")').click() // Click "Summer"

        // Thank you message
        await expect(surveyLocator.locator('.thank-you-message')).toBeVisible()
        await expect(surveyLocator.locator('.thank-you-message h3')).toHaveText(
            appearanceWithThanks.thankYouMessageHeader
        )
        await surveyLocator.locator('.form-submit').click() // Click to dismiss thank you
        await expect(surveyLocator.locator('.thank-you-message')).not.toBeVisible()

        // Event validation
        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        const surveySentEvent = captures.find(
            (c) => c.event === 'survey sent' && c.properties['$survey_id'] === surveyId
        )
        expect(surveySentEvent).toBeDefined()

        expect(surveySentEvent!.properties[getSurveyResponseKey(emojiRatingSkipButtonQuestion.id)]).toBe(2)
        expect(surveySentEvent!.properties[getSurveyResponseKey(numberRatingSkipButtonQuestion.id)]).toBe(4)
        expect(surveySentEvent!.properties[getSurveyResponseKey(singleChoiceSkipButtonQuestion.id)]).toBe('Summer')

        expect(surveySentEvent!.properties['$survey_questions']).toEqual(
            expect.arrayContaining([
                {
                    id: emojiRatingSkipButtonQuestion.id,
                    question: emojiRatingSkipButtonQuestion.question,
                    response: 2,
                },
                {
                    id: numberRatingSkipButtonQuestion.id,
                    question: numberRatingSkipButtonQuestion.question,
                    response: 4,
                },
                {
                    id: singleChoiceSkipButtonQuestion.id,
                    question: singleChoiceSkipButtonQuestion.question,
                    response: 'Summer',
                },
            ])
        )
    })
})
