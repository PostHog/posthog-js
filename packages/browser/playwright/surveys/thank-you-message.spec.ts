import { expect, test } from '../fixtures'
import { initSurveys } from './utils'

const emojiRatingQuestion = {
    type: 'rating',
    display: 'emoji',
    scale: 5,
    question: 'How happy are you with your purchase?',
    optional: true,
    id: 'emoji_rating_1',
}

const appearanceWithThanks = {
    displayThankYouMessage: true,
    thankyouMessageHeader: 'Thanks!',
    thankyouMessageBody: 'We appreciate your feedback.',
}

test.describe('surveys - feedback widget', () => {
    test.use({ flagsOverrides: { surveys: true }, url: './playground/cypress/index.html' })
    test('shows confirmation message after submitting', async ({ page, posthog, network }) => {
        await initSurveys(
            [
                {
                    id: '123',
                    name: 'Test survey',
                    type: 'popover',
                    start_date: '2021-01-01T00:00:00Z',
                    questions: [emojiRatingQuestion],
                    appearance: { ...appearanceWithThanks, backgroundColor: 'black' },
                },
            ],
            posthog,
            network
        )

        await expect(page.locator('.PostHogSurvey-123 .ratings-emoji')).toHaveCount(5)
        await page.locator('.PostHogSurvey-123 .ratings-emoji').first().click()

        await page.locator('.PostHogSurvey-123 .form-submit').click()
        await expect(page.locator('.PostHogSurvey-123 .thank-you-message')).toBeVisible()
    })

    test('counts down with auto disappear after 5 seconds', async ({ page, posthog, network }) => {
        await initSurveys(
            [
                {
                    id: '123',
                    name: 'Test survey',
                    type: 'popover',
                    start_date: '2021-01-01T00:00:00Z',
                    questions: [emojiRatingQuestion],
                    appearance: { ...appearanceWithThanks, autoDisappear: true },
                },
            ],
            posthog,
            network
        )

        await expect(page.locator('.PostHogSurvey-123 .ratings-emoji')).toHaveCount(5)
        await page.locator('.PostHogSurvey-123 .ratings-emoji').first().click()
        await page.locator('.PostHogSurvey-123 .form-submit').click()

        await expect(page.locator('.PostHogSurvey-123 .thank-you-message')).toBeVisible()
        await page.waitForTimeout(5000)
        await expect(page.locator('.PostHogSurvey-123 .thank-you-message')).not.toBeVisible()
    })
})
