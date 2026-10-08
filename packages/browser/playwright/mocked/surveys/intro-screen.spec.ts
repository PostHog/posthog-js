import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {},
    flagsResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

const openTextQuestion = {
    type: 'open',
    question: 'What can we do better?',
    id: 'open_text_1',
}

const appearanceWithIntro = {
    displayIntroScreen: true,
    introScreenHeader: 'Welcome!',
    introScreenDescription: 'Two quick questions about your experience.',
    introScreenButtonText: 'Get started',
}

test.describe('surveys - intro screen', () => {
    test('shows the intro screen before the first question and advances without capturing responses', async ({
        page,
        context,
    }) => {
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
                            appearance: appearanceWithIntro,
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        // Intro screen shows first, no question yet
        await expect(page.locator('.PostHogSurvey-123 .intro-screen')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123 .intro-screen-header')).toHaveText('Welcome!')
        await expect(page.locator('.PostHogSurvey-123 .survey-form')).not.toBeVisible()

        // Advancing dismisses the intro and shows question 0, without any survey event
        await page.locator('.PostHogSurvey-123 .form-submit').click()
        await expect(page.locator('.PostHogSurvey-123 .survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123 .intro-screen')).not.toBeVisible()

        const capturedEvents = await page.capturedEvents()
        const surveyEvents = capturedEvents.filter((e) => e.event.startsWith('survey '))
        expect(surveyEvents.map((e) => e.event)).toEqual(['survey shown'])
    })

    test('dismissing the survey from the intro screen captures survey dismissed', async ({ page, context }) => {
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
                            appearance: appearanceWithIntro,
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123 .intro-screen')).toBeVisible()
        await page.locator('.PostHogSurvey-123 button.form-cancel').click()
        await expect(page.locator('.PostHogSurvey-123 .intro-screen')).not.toBeVisible()

        await expect
            .poll(async () => {
                const capturedEvents = await page.capturedEvents()
                return capturedEvents.map((e) => e.event).filter((e) => e.startsWith('survey '))
            })
            .toEqual(['survey shown', 'survey dismissed'])
    })

    test('does not show the intro screen when displayIntroScreen is off', async ({ page, context }) => {
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
                            appearance: {},
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-123 .survey-form')).toBeVisible()
        await expect(page.locator('.PostHogSurvey-123 .intro-screen')).not.toBeVisible()
    })
})
