import { Page } from '@playwright/test'
import { pollUntilEventCaptured } from '../utils/event-capture-utils'
import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const openQuestion = (id: string, question: string, branching?: Record<string, unknown>) => ({
    type: 'open',
    question,
    id,
    ...(branching ? { branching } : {}),
})

const QUESTIONS = ['Question 1', 'Question 2', 'Question 3', 'Question 4']

const shuffledSurvey = (questions: unknown[]) => ({
    id: 'shuffle-e2e',
    name: 'Shuffle survey',
    type: 'popover',
    start_date: '2021-01-01T00:00:00Z',
    enable_partial_responses: false,
    questions,
    appearance: { shuffleQuestions: true, submitButtonText: 'Next', whiteLabel: true },
})

const startOptions = {
    options: { disable_surveys_automatic_display: true },
    flagsResponseOverrides: { surveys: true },
    url: './playground/cypress/index.html',
}

const displaySurvey = async (page: Page) => {
    await page.evaluate(() => {
        // @ts-expect-error - posthog is added to window in test setup
        window.posthog.onSurveysLoaded(() => window.posthog.displaySurvey('shuffle-e2e'))
    })
}

test.describe('surveys - shuffled questions', () => {
    test('shows every question exactly once when shuffling without branching', async ({ page, context }) => {
        await page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: { surveys: [shuffledSurvey(QUESTIONS.map((q, i) => openQuestion(`q${i}`, q)))] },
            })
        })

        await start(startOptions, page, context)
        await displaySurvey(page)

        const form = page.locator('.PostHogSurvey-shuffle-e2e')
        await expect(form.locator('.survey-question')).toBeVisible()

        const seen: string[] = []
        for (let step = 0; step < QUESTIONS.length; step++) {
            seen.push((await form.locator('.survey-question').first().innerText()).trim())
            await form.locator('textarea').first().fill('an answer')
            await form.locator('.form-submit').first().click()
            if (step < QUESTIONS.length - 1) {
                await expect
                    .poll(async () => (await form.locator('.survey-question').first().innerText()).trim())
                    .not.toBe(seen[seen.length - 1])
            }
        }

        // reverseIfUnshuffled guarantees a shuffled order never matches the configured one
        expect(seen).not.toEqual(QUESTIONS)
        expect(seen.slice().sort()).toEqual(QUESTIONS.slice().sort())
        await pollUntilEventCaptured(page, 'survey sent')
    })

    test('keeps the configured order when a question has branching', async ({ page, context }) => {
        const questions = [
            openQuestion('q0', 'Question 1'),
            openQuestion('q1', 'Question 2', { type: 'end' }),
            openQuestion('q2', 'Question 3'),
        ]
        await page.route('**/surveys/**', async (route) => {
            await route.fulfill({ json: { surveys: [shuffledSurvey(questions)] } })
        })

        await start(startOptions, page, context)
        await displaySurvey(page)

        const form = page.locator('.PostHogSurvey-shuffle-e2e')
        await expect(form.locator('.survey-question').first()).toHaveText('Question 1')

        await form.locator('textarea').first().fill('a1')
        await form.locator('.form-submit').first().click()

        await expect(form.locator('.survey-question').first()).toHaveText('Question 2')
        await form.locator('textarea').first().fill('a2')
        await form.locator('.form-submit').first().click()

        await pollUntilEventCaptured(page, 'survey sent')
    })
})
