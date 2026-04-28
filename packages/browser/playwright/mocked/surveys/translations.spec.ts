import { getSurveyResponseKey } from '@/extensions/surveys/surveys-extension-utils'
import { pollUntilEventCaptured } from '../utils/event-capture-utils'
import { expect, test } from '../utils/posthog-playwright-test-base'
import { start } from '../utils/setup'

const startOptions = {
    options: {
        override_display_language: 'es',
    },
    flagsResponseOverrides: {
        surveys: true,
    },
    url: './playground/cypress/index.html',
}

test.describe('surveys - translations', () => {
    test('renders translated copy and captures the applied language', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'translation-test',
                            name: 'Product feedback',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'single_choice',
                                    question: 'How was your experience?',
                                    choices: ['Good', 'Bad'],
                                    id: 'experience',
                                    translations: {
                                        es: {
                                            question: '¿Cómo fue tu experiencia?',
                                            choices: ['Buena', 'Mala'],
                                        },
                                    },
                                },
                            ],
                            appearance: {
                                displayThankYouMessage: true,
                                thankYouMessageHeader: 'Thank you!',
                                thankYouMessageDescription: 'We appreciate your feedback.',
                            },
                            translations: {
                                es: {
                                    name: 'Comentarios del producto',
                                    thankYouMessageHeader: '¡Gracias!',
                                    thankYouMessageDescription: 'Agradecemos tus comentarios.',
                                    thankYouMessageCloseButtonText: 'Cerrar',
                                },
                            },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)
        await surveysAPICall

        const survey = page.locator('.PostHogSurvey-translation-test')
        await expect(survey.locator('.survey-form')).toBeVisible()
        await expect(survey.locator('.survey-question')).toHaveText('¿Cómo fue tu experiencia?')
        await expect(survey.locator('label:has-text("Buena")')).toBeVisible()

        await survey.locator('label:has-text("Buena")').click()
        await survey.locator('.form-submit').click()

        await expect(survey.locator('.thank-you-message-header')).toHaveText('¡Gracias!')
        await expect(survey.locator('.thank-you-message-body')).toHaveText('Agradecemos tus comentarios.')
        await expect(survey.locator('.form-submit')).toHaveText('Cerrar')

        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        const surveySent = captures.find((capture) => capture.event === 'survey sent')
        expect(surveySent?.properties.$survey_language).toBe('es')
        expect(surveySent?.properties[getSurveyResponseKey('experience')]).toBe('Buena')
        expect(surveySent?.properties.$survey_questions).toEqual([
            {
                id: 'experience',
                question: '¿Cómo fue tu experiencia?',
                response: 'Buena',
            },
        ])
    })
})
