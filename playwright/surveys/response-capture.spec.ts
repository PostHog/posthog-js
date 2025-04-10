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

test.describe('surveys - feedback widget', () => {
    test('captures survey shown and sent events', async ({ page, context }) => {
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
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await pollUntilEventCaptured(page, 'survey shown')

        await page.locator('.PostHogSurvey123 textarea').type('experiments is awesome!')
        await page.locator('.PostHogSurvey123 .form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const surveySentEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === 'survey sent'))
        expect(surveySentEvent!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                [getSurveyResponseKey('open_text_1')]: 'experiments is awesome!',
                $survey_questions: [
                    {
                        id: 'open_text_1',
                        question: 'What feedback do you have for us?',
                        index: 0,
                    },
                ],
            })
        )
    })

    test('captures survey shown and sent events with iteration', async ({ page, context }) => {
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
                            current_iteration: 2,
                            current_iteration_start_date: '12-12-2004',
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await pollUntilEventCaptured(page, 'survey shown')
        const surveyShownEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === 'survey shown'))
        expect(surveyShownEvent!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                $survey_iteration: 2,
                $survey_iteration_start_date: '12-12-2004',
            })
        )

        await page.locator('.PostHogSurvey123 textarea').type('experiments is awesome!')
        await page.locator('.PostHogSurvey123 .form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const surveySentEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === 'survey sent'))
        expect(surveySentEvent!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                [getSurveyResponseKey('open_text_1')]: 'experiments is awesome!',
                $survey_iteration: 2,
                $survey_iteration_start_date: '12-12-2004',
                $survey_questions: [
                    {
                        id: 'open_text_1',
                        question: 'What feedback do you have for us?',
                        index: 0,
                    },
                ],
            })
        )
    })

    test('captures survey dismissed event', async ({ page, context }) => {
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
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await page.locator('.PostHogSurvey123 .cancel-btn-wrapper').click()
        await pollUntilEventCaptured(page, 'survey dismissed')
    })

    test('captures survey dismissed event with iteration', async ({ page, context }) => {
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
                            current_iteration: 2,
                            current_iteration_start_date: '12-12-2004',
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await page.locator('.PostHogSurvey123 .cancel-btn-wrapper').click()
        await pollUntilEventCaptured(page, 'survey dismissed')
        const surveyDismissedEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === 'survey dismissed'))
        expect(surveyDismissedEvent!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                $survey_iteration: 2,
                $survey_iteration_start_date: '12-12-2004',
            })
        )
    })
})
