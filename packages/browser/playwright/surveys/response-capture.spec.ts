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

        await page.locator('.PostHogSurvey-123 textarea').type('experiments is awesome!')
        await page.locator('.PostHogSurvey-123 .form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const surveySentEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === 'survey sent'))
        expect(surveySentEvent!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                [getSurveyResponseKey('open_text_1')]: 'experiments is awesome!',
                $survey_completed: true,
                $survey_submission_id: surveySentEvent!.properties['$survey_submission_id'],
                $survey_questions: [
                    {
                        id: 'open_text_1',
                        question: 'What feedback do you have for us?',
                        response: 'experiments is awesome!',
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

        await page.locator('.PostHogSurvey-123 textarea').type('experiments is awesome!')
        await page.locator('.PostHogSurvey-123 .form-submit').click()

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
                $survey_completed: true,
                $survey_submission_id: surveySentEvent!.properties['$survey_submission_id'],
                $survey_questions: [
                    {
                        id: 'open_text_1',
                        question: 'What feedback do you have for us?',
                        response: 'experiments is awesome!',
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

        await page.locator('.PostHogSurvey-123 .form-cancel').click()
        await pollUntilEventCaptured(page, 'survey dismissed')
        const surveyDismissedEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === 'survey dismissed'))
        expect(surveyDismissedEvent!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                $survey_partially_completed: false,
            })
        )
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

        await page.locator('.PostHogSurvey-123 .form-cancel').click()
        await pollUntilEventCaptured(page, 'survey dismissed')
        const surveyDismissedEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === 'survey dismissed'))
        expect(surveyDismissedEvent!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                $survey_iteration: 2,
                $survey_iteration_start_date: '12-12-2004',
                $survey_partially_completed: false,
            })
        )
    })

    test('captures survey partially sent event', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            enable_partial_responses: true,
                            questions: [
                                openTextQuestion,
                                {
                                    ...openTextQuestion,
                                    question: 'this is the second question',
                                    id: 'open_text_2',
                                },
                                {
                                    ...openTextQuestion,
                                    question: 'this is the third question',
                                    id: 'open_text_3',
                                },
                            ],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await pollUntilEventCaptured(page, 'survey shown')

        await page.locator('.PostHogSurvey-123 textarea').fill('experiments is awesome!')
        await page.locator('.PostHogSurvey-123 .form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const surveySentEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === 'survey sent'))
        expect(surveySentEvent!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                [getSurveyResponseKey('open_text_1')]: 'experiments is awesome!',
                $survey_completed: false,
                $survey_submission_id: surveySentEvent!.properties['$survey_submission_id'],
            })
        )

        await page.locator('.PostHogSurvey-123 textarea').fill('partial responses!')
        await page.locator('.PostHogSurvey-123 .form-submit').click()
        await pollUntilEventCaptured(page, 'survey sent')
        const surveySentEvent2 = await page.capturedEvents().then((events) => getLastSurveySentEvent(events))
        expect(surveySentEvent2!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                $survey_submission_id: surveySentEvent!.properties['$survey_submission_id'], // same submission id as before
                [getSurveyResponseKey('open_text_1')]: 'experiments is awesome!',
                [getSurveyResponseKey('open_text_2')]: 'partial responses!',
                $survey_completed: false,
            })
        )

        await page.locator('.PostHogSurvey-123 textarea').fill('partial responses is finished!')
        await page.locator('.PostHogSurvey-123 .form-submit').click()
        await pollUntilEventCaptured(page, 'survey sent')
        const surveySentEvent3 = await page.capturedEvents().then((events) => getLastSurveySentEvent(events))
        expect(surveySentEvent3!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                $survey_submission_id: surveySentEvent!.properties['$survey_submission_id'], // same submission id as before
                [getSurveyResponseKey('open_text_1')]: 'experiments is awesome!',
                [getSurveyResponseKey('open_text_2')]: 'partial responses!',
                [getSurveyResponseKey('open_text_3')]: 'partial responses is finished!',
                $survey_completed: true,
            })
        )
    })

    test('captures survey partially sent event then dismissed', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            enable_partial_responses: true,
                            questions: [
                                openTextQuestion,
                                {
                                    ...openTextQuestion,
                                    question: 'this is the second question',
                                    id: 'open_text_2',
                                },
                                {
                                    ...openTextQuestion,
                                    question: 'this is the third question',
                                    id: 'open_text_3',
                                },
                            ],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await pollUntilEventCaptured(page, 'survey shown')

        await page.locator('.PostHogSurvey-123 textarea').fill('experiments is awesome!')
        await page.locator('.PostHogSurvey-123 .form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const surveySentEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === 'survey sent'))
        expect(surveySentEvent!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                [getSurveyResponseKey('open_text_1')]: 'experiments is awesome!',
                $survey_completed: false,
                $survey_submission_id: surveySentEvent!.properties['$survey_submission_id'],
            })
        )

        await page.locator('.PostHogSurvey-123 textarea').fill('partial responses!')
        await page.locator('.PostHogSurvey-123 .form-submit').click()
        await pollUntilEventCaptured(page, 'survey sent')
        const surveySentEvent2 = await page.capturedEvents().then((events) => getLastSurveySentEvent(events))
        expect(surveySentEvent2!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                $survey_submission_id: surveySentEvent!.properties['$survey_submission_id'], // same submission id as before
                [getSurveyResponseKey('open_text_1')]: 'experiments is awesome!',
                [getSurveyResponseKey('open_text_2')]: 'partial responses!',
                $survey_completed: false,
            })
        )

        await page.locator('.PostHogSurvey-123 .form-cancel').click()
        await pollUntilEventCaptured(page, 'survey dismissed')
        const surveyDismissedEvent = await page
            .capturedEvents()
            .then((events) => events.find((e) => e.event === 'survey dismissed'))
        expect(surveyDismissedEvent!.properties).toEqual(
            expect.objectContaining({
                $survey_id: '123',
                $survey_partially_completed: true,
                [getSurveyResponseKey('open_text_1')]: 'experiments is awesome!',
                [getSurveyResponseKey('open_text_2')]: 'partial responses!',
            })
        )
    })
})

function getLastSurveySentEvent(events: any[]) {
    return events.filter((e) => e.event === 'survey sent').at(-1)
}
