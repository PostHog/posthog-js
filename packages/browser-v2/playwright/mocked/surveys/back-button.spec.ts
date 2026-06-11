import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {},
    flagsResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

const q1 = { type: 'open', question: 'Question 1', id: 'q1' }
const q2 = { type: 'open', question: 'Question 2', id: 'q2' }
const q3 = { type: 'open', question: 'Question 3', id: 'q3' }

test.describe('surveys - back button', () => {
    test('shows back button only after advancing, returns to previous question with prior answer pre-filled', async ({
        page,
        context,
    }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Back nav survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [q1, q2, q3],
                            appearance: {
                                allowGoBack: true,
                                whiteLabel: true,
                            },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        const survey = page.locator('.PostHogSurvey-123')
        await expect(survey.locator('.survey-question')).toHaveText('Question 1')
        await expect(survey.locator('.form-back')).toBeHidden()

        await survey.locator('textarea').fill('first answer')
        await survey.locator('.form-submit').click()

        await expect(survey.locator('.survey-question')).toHaveText('Question 2')
        await expect(survey.locator('.form-back')).toBeVisible()

        await survey.locator('.form-back').click()

        await expect(survey.locator('.survey-question')).toHaveText('Question 1')
        await expect(survey.locator('textarea')).toHaveValue('first answer')
        await expect(survey.locator('.form-back')).toBeHidden()
    })

    test('back button is not rendered when allowGoBack is not set', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '124',
                            name: 'No back nav',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [q1, q2],
                            appearance: { whiteLabel: true },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        const survey = page.locator('.PostHogSurvey-124')
        await survey.locator('textarea').fill('answer')
        await survey.locator('.form-submit').click()

        await expect(survey.locator('.survey-question')).toHaveText('Question 2')
        await expect(survey.locator('.form-back')).toHaveCount(0)
    })
})
