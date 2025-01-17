import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {},
    decideResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

const emojiRatingQuestion = {
    type: 'rating',
    display: 'emoji',
    scale: 5,
    question: 'How happy are you with your purchase?',
    optional: true,
}

const appearanceWithThanks = {
    displayThankYouMessage: true,
    thankyouMessageHeader: 'Thanks!',
    thankyouMessageBody: 'We appreciate your feedback.',
}

test.describe('surveys - feedback widget', () => {
    test('shows confirmation message after submitting', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [emojiRatingQuestion],
                            appearance: { ...appearanceWithThanks, backgroundColor: 'black' },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey123 .ratings-emoji')).toHaveCount(5)
        await page.locator('.PostHogSurvey123 .ratings-emoji').first().click()

        await page.locator('.PostHogSurvey123 .form-submit').click()
        await expect(page.locator('.PostHogSurvey123 .thank-you-message')).toBeVisible()
    })

    test('counts down with auto disappear after 5 seconds', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: '123',
                            name: 'Test survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [emojiRatingQuestion],
                            appearance: { ...appearanceWithThanks, autoDisappear: true },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey123 .ratings-emoji')).toHaveCount(5)
        await page.locator('.PostHogSurvey123 .ratings-emoji').first().click()
        await page.locator('.PostHogSurvey123 .form-submit').click()

        await expect(page.locator('.PostHogSurvey123 .thank-you-message')).toBeVisible()
        await page.waitForTimeout(5000)
        await expect(page.locator('.PostHogSurvey123 .thank-you-message')).not.toBeVisible()
    })
})
