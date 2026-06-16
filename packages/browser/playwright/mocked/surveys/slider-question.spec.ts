import { getSurveyResponseKey } from '@/extensions/surveys/surveys-extension-utils'
import { pollUntilEventCaptured } from '../utils/event-capture-utils'
import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {},
    flagsResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

const sliderQuestion = {
    type: 'slider' as const,
    question: 'How likely are you to recommend us?',
    id: 'slider_1',
    min: 0,
    max: 10,
    step: 1,
    lowerBoundLabel: 'Not likely',
    upperBoundLabel: 'Very likely',
}

const appearanceWithThanks = {
    displayThankYouMessage: true,
    thankYouMessageHeader: 'Thanks!',
    thankYouMessageBody: 'We appreciate your feedback.',
}

test.describe('surveys - slider question', () => {
    test('renders the slider with a default value snapped to the middle of the range', async ({ page, context }) => {
        const surveyId = 'slider_default_survey'
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: surveyId,
                            name: 'Slider survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [sliderQuestion],
                            appearance: appearanceWithThanks,
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        const surveyLocator = page.locator(`.PostHogSurvey-${surveyId}`)
        await expect(surveyLocator.locator('.survey-form')).toBeVisible()
        await expect(surveyLocator.locator('.survey-question')).toHaveText(sliderQuestion.question)

        // Bound labels are rendered on either side of the value
        await expect(surveyLocator.locator('.slider-label-left')).toHaveText(sliderQuestion.lowerBoundLabel)
        await expect(surveyLocator.locator('.slider-label-right')).toHaveText(sliderQuestion.upperBoundLabel)

        // Default value is the middle of the range (0..10 -> 5), and the thumb matches the displayed value
        await expect(surveyLocator.locator('.slider-value')).toHaveText('5')
        await expect(surveyLocator.locator('.slider-input')).toHaveJSProperty('value', '5')

        // Submitting without touching the slider records the default value
        await surveyLocator.locator('.form-submit').click()

        await expect(surveyLocator.locator('.thank-you-message')).toBeVisible()
        await surveyLocator.locator('.form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        const surveySent = captures.find((c) => c.event === 'survey sent' && c.properties['$survey_id'] === surveyId)
        expect(surveySent).toBeDefined()
        expect(surveySent!.properties[getSurveyResponseKey(sliderQuestion.id)]).toBe(5)
        expect(surveySent!.properties['$survey_questions']).toEqual([
            {
                id: sliderQuestion.id,
                question: sliderQuestion.question,
                response: 5,
            },
        ])
    })

    test('captures the value the user selects on the slider', async ({ page, context }) => {
        const surveyId = 'slider_select_survey'
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: surveyId,
                            name: 'Slider survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [sliderQuestion],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        const surveyLocator = page.locator(`.PostHogSurvey-${surveyId}`)
        await expect(surveyLocator.locator('.survey-form')).toBeVisible()

        // Move the slider from the default (5) up to 7 using the keyboard, which fires input events for each step
        const slider = surveyLocator.locator('.slider-input')
        await slider.focus()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')

        await expect(surveyLocator.locator('.slider-value')).toHaveText('7')
        await surveyLocator.locator('.form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        const surveySent = captures.find((c) => c.event === 'survey sent' && c.properties['$survey_id'] === surveyId)
        expect(surveySent).toBeDefined()
        expect(surveySent!.properties[getSurveyResponseKey(sliderQuestion.id)]).toBe(7)
        expect(surveySent!.properties['$survey_questions']).toEqual([
            {
                id: sliderQuestion.id,
                question: sliderQuestion.question,
                response: 7,
            },
        ])
    })

    test('snaps the default value to a valid step position', async ({ page, context }) => {
        const surveyId = 'slider_step_survey'
        // min=0, max=10, step=3 -> raw midpoint 5 snaps to the nearest valid step (6),
        // so the chip and the browser-normalised thumb agree on first render.
        const steppedSliderQuestion = { ...sliderQuestion, id: 'slider_step_1', step: 3 }
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: surveyId,
                            name: 'Slider survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [steppedSliderQuestion],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        const surveyLocator = page.locator(`.PostHogSurvey-${surveyId}`)
        await expect(surveyLocator.locator('.survey-form')).toBeVisible()

        await expect(surveyLocator.locator('.slider-value')).toHaveText('6')
        await expect(surveyLocator.locator('.slider-input')).toHaveJSProperty('value', '6')

        await surveyLocator.locator('.form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        const surveySent = captures.find((c) => c.event === 'survey sent' && c.properties['$survey_id'] === surveyId)
        expect(surveySent).toBeDefined()
        expect(surveySent!.properties[getSurveyResponseKey(steppedSliderQuestion.id)]).toBe(6)
    })

    test('captures screenshots of the slider in representative states', async ({ page, context }) => {
        const surveyId = 'slider_screenshot_survey'
        const screenshotSliderQuestion = {
            ...sliderQuestion,
            id: 'slider_screenshot_1',
            question: 'How likely are you to recommend PostHog?',
            description: 'Drag the slider, or use the arrow keys.',
            prefix: '',
            suffix: '/10',
        }
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: surveyId,
                            name: 'Slider survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [screenshotSliderQuestion],
                            appearance: appearanceWithThanks,
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        const surveyLocator = page.locator(`.PostHogSurvey-${surveyId}`)
        await expect(surveyLocator.locator('.survey-form')).toBeVisible()

        // 1) Default state — middle-of-range, with suffix and bound labels
        await page.screenshot({ path: 'playwright/mocked/surveys/screenshots/slider-default.png' })

        // 2) After moving the slider with the keyboard to a higher value
        const slider = surveyLocator.locator('.slider-input')
        await slider.focus()
        for (let i = 0; i < 4; i++) {
            await page.keyboard.press('ArrowRight')
        }
        await expect(surveyLocator.locator('.slider-value')).toHaveText('9/10')
        await page.screenshot({ path: 'playwright/mocked/surveys/screenshots/slider-selected.png' })

        // 3) Thank-you state after submitting
        await surveyLocator.locator('.form-submit').click()
        await expect(surveyLocator.locator('.thank-you-message')).toBeVisible()
        await page.screenshot({ path: 'playwright/mocked/surveys/screenshots/slider-thank-you.png' })
    })

    test('renders the configured prefix and suffix around the value', async ({ page, context }) => {
        const surveyId = 'slider_affix_survey'
        const affixSliderQuestion = {
            ...sliderQuestion,
            id: 'slider_affix_1',
            prefix: '$',
            suffix: 'k',
        }
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: surveyId,
                            name: 'Slider survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [affixSliderQuestion],
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        const surveyLocator = page.locator(`.PostHogSurvey-${surveyId}`)
        await expect(surveyLocator.locator('.survey-form')).toBeVisible()

        // Default value 5 with prefix "$" and suffix "k"
        await expect(surveyLocator.locator('.slider-value')).toHaveText('$5k')
    })
})
