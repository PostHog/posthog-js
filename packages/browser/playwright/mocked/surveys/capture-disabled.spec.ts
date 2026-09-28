import type { PostHog } from '../../../src/posthog-core'
import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'
import { pollUntilEventCaptured } from '../utils/event-capture-utils'

const survey = {
    id: 'capture-disabled-survey',
    name: 'Feedback',
    type: 'popover',
    start_date: '2021-01-01T00:00:00Z',
    questions: [
        { id: 'first', type: 'open', question: 'What worked well?' },
        { id: 'second', type: 'open', question: 'What could improve?' },
    ],
    appearance: { displayThankYouMessage: true, thankYouMessageHeader: 'Thank you!' },
}

test.beforeEach(async ({ page, context }) => {
    await page.route('**/surveys/**', (route) => route.fulfill({ json: { surveys: [survey] } }))
    await start(
        {
            options: { disable_surveys_automatic_display: true },
            flagsResponseOverrides: { surveys: true },
            url: './playground/cypress/index.html',
        },
        page,
        context
    )
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                (window as unknown as { posthog: PostHog }).posthog.onSurveysLoaded(() => resolve())
            )
    )
})

for (const method of ['renderSurvey', 'displaySurvey'] as const) {
    test(`${method} stays hidden until capturing is enabled`, async ({ page }) => {
        const warnings: string[] = []
        page.on('console', (message) => {
            if (message.type() === 'warning' || message.type() === 'error') {
                warnings.push(message.text())
            }
        })
        await page.evaluate((method) => {
            const posthog = (window as unknown as { posthog: PostHog }).posthog
            posthog.opt_out_capturing()
            if (method === 'renderSurvey') {
                posthog.renderSurvey('capture-disabled-survey', '#survey')
            } else {
                posthog.displaySurvey('capture-disabled-survey', { ignoreConditions: true })
            }
        }, method)
        await expect(page.locator('.survey-form')).toHaveCount(0)
        expect(warnings).toEqual([])

        await page.evaluate((method) => {
            const posthog = (window as unknown as { posthog: PostHog }).posthog
            posthog.opt_in_capturing()
            if (method === 'renderSurvey') {
                posthog.renderSurvey('capture-disabled-survey', '#survey')
            } else {
                posthog.displaySurvey('capture-disabled-survey', { ignoreConditions: true })
            }
        }, method)
        await expect(page.locator('.survey-form')).toBeVisible()
    })
}

test('an opt-out while answering preserves the draft and does not show success', async ({ page }) => {
    await page.evaluate(() =>
        (window as unknown as { posthog: PostHog }).posthog.displaySurvey('capture-disabled-survey')
    )
    await page.locator('textarea').fill('Navigation worked well')
    await page.locator('.form-submit').click()
    await expect(page.locator('.survey-question')).toHaveText('What could improve?')
    await page.locator('textarea').fill('A clearer search button')
    const draft = await page.evaluate(() => localStorage.getItem('inProgressSurvey_capture-disabled-survey'))
    expect(draft).toContain('Navigation worked well')
    await page.evaluate(() => (window as unknown as { posthog: PostHog }).posthog.opt_out_capturing())

    await page.locator('.form-submit').click()

    await expect(page.getByRole('alert')).toHaveText('Your response could not be sent. Please try again later.')
    await expect(page.locator('textarea')).toHaveValue('A clearer search button')
    await expect(page.getByText('Thank you!', { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('inProgressSurvey_capture-disabled-survey'))).toBe(draft)
    expect(await page.evaluate(() => localStorage.getItem('seenSurvey_capture-disabled-survey'))).toBeNull()
    expect((await page.capturedEvents()).filter((event) => event.event === 'survey sent')).toEqual([])

    await page.evaluate(() => (window as unknown as { posthog: PostHog }).posthog.opt_in_capturing())
    await page.locator('.form-submit').click()
    await pollUntilEventCaptured(page, 'survey sent')
    await expect(page.getByText('Thank you!', { exact: true })).toBeVisible()
    const sent = (await page.capturedEvents()).filter((event) => event.event === 'survey sent')
    expect(sent).toHaveLength(1)
    expect(sent[0].properties).toMatchObject({
        $survey_response_first: 'Navigation worked well',
        $survey_response_second: 'A clearer search button',
        $survey_completed: true,
    })
})

test('a delayed direct render rechecks capture before showing the form', async ({ page }) => {
    await page.clock.install()
    await page.evaluate(() => {
        const posthog = (window as unknown as { posthog: PostHog }).posthog
        posthog.getSurveys((surveys) => {
            const survey = surveys.find((survey) => survey.id === 'capture-disabled-survey')!
            survey.appearance = { ...survey.appearance, surveyPopupDelaySeconds: 1 }
            posthog.renderSurvey(survey.id, '#survey')
            posthog.opt_out_capturing()
        })
    })
    await page.clock.runFor(1500)
    await expect(page.locator('.survey-form')).toHaveCount(0)
})
