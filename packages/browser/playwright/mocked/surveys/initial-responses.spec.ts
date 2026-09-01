import { Page } from '@playwright/test'
import { pollUntilEventCaptured } from '../utils/event-capture-utils'
import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const question = (id: string, text: string, skipSubmitButton = false) => ({
    type: 'single_choice',
    question: text,
    id,
    choices: ['yes', 'no'],
    ...(skipSubmitButton ? { skipSubmitButton: true } : {}),
})

const surveyWith = (questions: unknown[]) => ({
    id: 'initial-responses',
    name: 'Initial responses survey',
    type: 'popover',
    start_date: '2021-01-01T00:00:00Z',
    enable_partial_responses: false,
    questions,
    appearance: { whiteLabel: true },
})

const startOptions = {
    options: { disable_surveys_automatic_display: true },
    flagsResponseOverrides: { surveys: true },
    url: './playground/cypress/index.html',
}

const displayWithPrefill = async (page: Page, initialResponses: Record<number, unknown>) => {
    await page.evaluate((responses: Record<number, unknown>) => {
        // @ts-expect-error - posthog is added to window in test setup
        window.posthog.onSurveysLoaded(() =>
            // @ts-expect-error - posthog is added to window in test setup
            window.posthog.displaySurvey('initial-responses', { displayType: 'popover', initialResponses: responses })
        )
    }, initialResponses)
}

const sentEvents = async (page: Page) => (await page.capturedEvents()).filter((e) => e.event === 'survey sent')

test.describe('surveys - initialResponses prefill gate', () => {
    test('does not store an incomplete response when partial responses are off', async ({ page, context }) => {
        await page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: { surveys: [surveyWith([question('q0', 'Question 1', true), question('q1', 'Question 2')])] },
            })
        })

        await start(startOptions, page, context)
        await displayWithPrefill(page, { 0: 0 })

        const form = page.locator('.PostHogSurvey-initial-responses')
        await expect(form.locator('.survey-question').first()).toHaveText('Question 2')
        await pollUntilEventCaptured(page, 'survey shown')
        expect(await sentEvents(page)).toHaveLength(0)

        await form.getByText('no').first().click()
        await form.locator('.form-submit').first().click()

        await pollUntilEventCaptured(page, 'survey sent')
        const [sent] = await sentEvents(page)
        expect(sent.properties.$survey_completed).toBe(true)
        expect(sent.properties.$survey_response_q0).toBe('yes')
        expect(sent.properties.$survey_response_q1).toBe('no')
    })

    test('stores the response when the prefill answers every question', async ({ page, context }) => {
        await page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [surveyWith([question('q0', 'Question 1', true), question('q1', 'Question 2', true)])],
                },
            })
        })

        await start(startOptions, page, context)
        await displayWithPrefill(page, { 0: 0, 1: 1 })

        await pollUntilEventCaptured(page, 'survey sent')
        const [sent] = await sentEvents(page)
        expect(sent.properties.$survey_completed).toBe(true)
    })
})
