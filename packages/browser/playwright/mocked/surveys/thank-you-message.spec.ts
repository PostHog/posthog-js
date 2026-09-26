import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {},
    flagsResponseOverrides: {
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
    id: 'emoji_rating_1',
}

const appearanceWithThanks = {
    displayThankYouMessage: true,
    thankYouMessageHeader: 'Thanks!',
    thankYouMessageDescription: 'We appreciate your feedback.',
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

        await expect(page.locator('.PostHogSurvey-123 .ratings-emoji')).toHaveCount(5)
        await page.locator('.PostHogSurvey-123 .ratings-emoji').first().click()

        await page.locator('.PostHogSurvey-123 .form-submit').click()
        await expect(page.locator('.PostHogSurvey-123 .thank-you-message')).toBeVisible()
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

        await page.clock.install({ time: new Date('2024-01-01T00:00:00Z') })
        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123 .ratings-emoji')).toHaveCount(5)
        await page.clock.pauseAt(new Date('2024-01-01T00:01:00Z'))
        await page.locator('.PostHogSurvey-123 .ratings-emoji').first().click()
        await page.clock.runFor(50)
        await page.locator('.PostHogSurvey-123 .form-submit').click()
        await page.clock.runFor(50)

        await expect(page.locator('.PostHogSurvey-123 .thank-you-message')).toBeVisible()
        await page.clock.runFor(4949)
        await expect(page.locator('.PostHogSurvey-123 .thank-you-message')).toBeVisible()
        await page.clock.runFor(1)
        // The close animation has a separate fallback unmount timer.
        await page.clock.runFor(500)
        await expect(page.locator('.PostHogSurvey-123 .thank-you-message')).not.toBeVisible()
    })
})
