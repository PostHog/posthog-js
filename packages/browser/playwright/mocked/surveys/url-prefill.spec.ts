import { getSurveyResponseKey } from '@/extensions/surveys/surveys-extension-utils'
import { pollUntilEventCaptured } from '../utils/event-capture-utils'
import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const thumbsQuestion = {
    type: 'rating',
    question: 'Was this helpful?',
    id: 'thumbs_1',
    display: 'emoji',
    scale: 3,
    skipSubmitButton: true,
}

const followUpQuestion = {
    type: 'open',
    question: 'Tell us more',
    id: 'follow_up_1',
    optional: true,
}

const prefillSurvey = {
    id: 'prefill-123',
    name: 'Email feedback survey',
    type: 'popover',
    start_date: '2021-01-01T00:00:00Z',
    enable_partial_responses: true,
    questions: [thumbsQuestion, followUpQuestion],
}

test.describe('surveys - URL prefill with auto-submit', () => {
    test('keeps the auto-submitted answer and caller properties on the follow-up submission', async ({
        page,
        context,
    }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({ json: { surveys: [prefillSurvey] } })
        })

        await start(
            {
                options: {
                    disable_surveys_automatic_display: true,
                    surveys: { prefillFromUrl: true },
                },
                flagsResponseOverrides: { surveys: true },
                url: './playground/cypress/index.html?q0=3&account_number=12345',
            },
            page,
            context
        )
        await surveysAPICall

        // The hosted survey page renders on demand and passes the custom URL params as properties.
        await page.evaluate((survey) => {
            const ph = (window as any).posthog
            const container = document.createElement('div')
            container.id = 'hosted-survey-container'
            document.body.appendChild(container)
            ph.surveys['_surveyManager'].renderSurvey(survey, container, { account_number: '12345' })
        }, prefillSurvey as any)

        await pollUntilEventCaptured(page, 'survey sent')
        const autoSubmitted = await page
            .capturedEvents()
            .then((events) => events.filter((e) => e.event === 'survey sent'))
        expect(autoSubmitted).toHaveLength(1)
        expect(autoSubmitted[0]!.properties).toEqual(
            expect.objectContaining({
                [getSurveyResponseKey('thumbs_1')]: 3,
                $survey_completed: false,
                account_number: '12345',
            })
        )

        await page.locator('#hosted-survey-container textarea').fill('it was great')
        await page.locator('#hosted-survey-container .form-submit').click()

        await expect
            .poll(async () => (await page.capturedEvents()).filter((e) => e.event === 'survey sent').length)
            .toBe(2)
        const sentEvents = await page.capturedEvents().then((events) => events.filter((e) => e.event === 'survey sent'))
        expect(sentEvents[1]!.properties).toEqual(
            expect.objectContaining({
                $survey_submission_id: autoSubmitted[0]!.properties['$survey_submission_id'],
                [getSurveyResponseKey('thumbs_1')]: 3,
                [getSurveyResponseKey('follow_up_1')]: 'it was great',
                $survey_completed: true,
                account_number: '12345',
            })
        )
    })
})
