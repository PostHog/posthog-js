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

const ratingQuestionWithTranslations = {
    type: 'rating',
    display: 'number',
    scale: 5,
    question: 'How satisfied are you with our product?',
    description: 'Please rate from 1 to 5',
    lowerBoundLabel: 'Not satisfied',
    upperBoundLabel: 'Very satisfied',
    id: 'rating_translated_1',
    translations: {
        fr: {
            question: 'Dans quelle mesure êtes-vous satisfait de notre produit?',
            description: 'Veuillez évaluer de 1 à 5',
            lowerBoundLabel: 'Pas satisfait',
            upperBoundLabel: 'Très satisfait',
        },
        es: {
            question: '¿Qué tan satisfecho estás con nuestro producto?',
            description: 'Por favor califica del 1 al 5',
            lowerBoundLabel: 'No satisfecho',
            upperBoundLabel: 'Muy satisfecho',
        },
    },
}

const multipleChoiceQuestionWithTranslations = {
    type: 'multiple_choice',
    question: 'Which features do you use?',
    choices: ['Analytics', 'Session Replay', 'Feature Flags', 'Surveys'],
    id: 'multiple_choice_translated_1',
    translations: {
        fr: {
            question: 'Quelles fonctionnalités utilisez-vous?',
            choices: ['Analytique', 'Relecture de session', 'Indicateurs de fonctionnalités', 'Enquêtes'],
        },
    },
}

const openTextQuestionWithTranslations = {
    type: 'open',
    question: 'What would you improve?',
    description: 'Tell us your thoughts',
    buttonText: 'Submit',
    id: 'open_translated_1',
    translations: {
        fr: {
            question: 'Que souhaiteriez-vous améliorer?',
            description: 'Partagez vos pensées',
            buttonText: 'Soumettre',
        },
    },
}

const appearanceWithTranslations = {
    displayThankYouMessage: true,
    thankYouMessageHeader: 'Thank you!',
    thankYouMessageDescription: 'We appreciate your feedback',
    thankYouMessageCloseButtonText: 'Close',
}

test.describe('surveys - translations', () => {
    test('displays survey in French when language is set to fr', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'translation-test-fr',
                            name: 'Product Feedback Survey',
                            description: 'Help us improve',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [ratingQuestionWithTranslations],
                            appearance: appearanceWithTranslations,
                            translations: {
                                fr: {
                                    name: 'Enquête de satisfaction produit',
                                    description: 'Aidez-nous à améliorer',
                                    thankYouMessageHeader: 'Merci!',
                                    thankYouMessageDescription: 'Nous apprécions vos commentaires',
                                    thankYouMessageCloseButtonText: 'Fermer',
                                },
                            },
                        },
                    ],
                },
            })
        })

        await start(
            {
                ...startOptions,
                runBeforePostHogInit: (page) => {
                    page.evaluate(() => {
                        // Set person properties in localStorage before PostHog initializes
                        localStorage.setItem(
                            'ph_test token_posthog',
                            JSON.stringify({
                                $stored_person_properties: { language: 'fr' },
                            })
                        )
                    })
                },
            },
            page,
            context
        )

        await surveysAPICall

        // Wait for survey to appear
        await expect(page.locator('.PostHogSurvey-translation-test-fr').locator('.survey-form')).toBeVisible()

        // Check that French text is displayed
        await expect(page.locator('.PostHogSurvey-translation-test-fr .survey-question')).toContainText(
            'Dans quelle mesure êtes-vous satisfait de notre produit?'
        )
        await expect(page.locator('.PostHogSurvey-translation-test-fr .survey-question-description')).toContainText(
            'Veuillez évaluer de 1 à 5'
        )
        await expect(page.locator('.PostHogSurvey-translation-test-fr .rating-text div').first()).toContainText(
            'Pas satisfait'
        )
        await expect(page.locator('.PostHogSurvey-translation-test-fr .rating-text div').last()).toContainText(
            'Très satisfait'
        )

        // Submit the survey
        await page.locator('.PostHogSurvey-translation-test-fr .ratings-number').first().click()
        await page.locator('.PostHogSurvey-translation-test-fr .form-submit').click()

        // Check thank you message is in French
        await expect(page.locator('.PostHogSurvey-translation-test-fr .thank-you-message-header')).toContainText(
            'Merci!'
        )
        await expect(page.locator('.PostHogSurvey-translation-test-fr .thank-you-message-body')).toContainText(
            'Nous apprécions vos commentaires'
        )
        await expect(page.locator('.PostHogSurvey-translation-test-fr .form-submit')).toContainText('Fermer')

        // Verify $survey_language is tracked in the event
        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        const surveyEvent = captures.find((c) => c.event === 'survey sent')
        expect(surveyEvent?.properties.$survey_language).toBe('fr')
    })

    test('displays survey in Spanish when language is set to es', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'translation-test-es',
                            name: 'Product Feedback Survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [ratingQuestionWithTranslations],
                            appearance: { displayThankYouMessage: false },
                        },
                    ],
                },
            })
        })

        await start(
            {
                ...startOptions,
                runBeforePostHogInit: (page) => {
                    page.evaluate(() => {
                        localStorage.setItem(
                            'ph_test token_posthog',
                            JSON.stringify({
                                $stored_person_properties: { language: 'es' },
                            })
                        )
                    })
                },
            },
            page,
            context
        )

        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-translation-test-es').locator('.survey-form')).toBeVisible()

        // Check Spanish translation
        await expect(page.locator('.PostHogSurvey-translation-test-es .survey-question')).toContainText(
            '¿Qué tan satisfecho estás con nuestro producto?'
        )
        await expect(page.locator('.PostHogSurvey-translation-test-es .survey-question-description')).toContainText(
            'Por favor califica del 1 al 5'
        )
        await expect(page.locator('.PostHogSurvey-translation-test-es .rating-text div').first()).toContainText(
            'No satisfecho'
        )
        await expect(page.locator('.PostHogSurvey-translation-test-es .rating-text div').last()).toContainText(
            'Muy satisfecho'
        )

        // Submit and verify language tracking
        await page.locator('.PostHogSurvey-translation-test-es .ratings-number').first().click()
        await page.locator('.PostHogSurvey-translation-test-es .form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        const surveyEvent = captures.find((c) => c.event === 'survey sent')
        expect(surveyEvent?.properties.$survey_language).toBe('es')
    })

    test('falls back to base language when variant is set (fr-CA -> fr)', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'translation-test-fallback',
                            name: 'Product Feedback Survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [ratingQuestionWithTranslations],
                            appearance: { displayThankYouMessage: false },
                        },
                    ],
                },
            })
        })

        await start(
            {
                ...startOptions,
                runBeforePostHogInit: (page) => {
                    page.evaluate(() => {
                        localStorage.setItem(
                            'ph_test token_posthog',
                            JSON.stringify({
                                $stored_person_properties: { language: 'fr-CA' },
                            })
                        )
                    })
                },
            },
            page,
            context
        )

        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-translation-test-fallback').locator('.survey-form')).toBeVisible()

        // Should display French (not English) because it falls back to 'fr'
        await expect(page.locator('.PostHogSurvey-translation-test-fallback .survey-question')).toContainText(
            'Dans quelle mesure êtes-vous satisfait de notre produit?'
        )

        // Submit and verify base language is tracked
        await page.locator('.PostHogSurvey-translation-test-fallback .ratings-number').first().click()
        await page.locator('.PostHogSurvey-translation-test-fallback .form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        const surveyEvent = captures.find((c) => c.event === 'survey sent')
        // Should track 'fr' (the matched base language) not 'fr-CA'
        expect(surveyEvent?.properties.$survey_language).toBe('fr')
    })

    test('displays default language when no translation exists', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'translation-test-default',
                            name: 'Product Feedback Survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [ratingQuestionWithTranslations],
                            appearance: { displayThankYouMessage: false },
                        },
                    ],
                },
            })
        })

        await start(
            {
                ...startOptions,
                runBeforePostHogInit: (page) => {
                    page.evaluate(() => {
                        localStorage.setItem(
                            'ph_test token_posthog',
                            JSON.stringify({
                                $stored_person_properties: { language: 'de' },
                            })
                        )
                    })
                },
            },
            page,
            context
        )

        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-translation-test-default').locator('.survey-form')).toBeVisible()

        // Should display English (default) since no German translation exists
        await expect(page.locator('.PostHogSurvey-translation-test-default .survey-question')).toContainText(
            'How satisfied are you with our product?'
        )
        await expect(page.locator('.PostHogSurvey-translation-test-default .rating-text div').first()).toContainText(
            'Not satisfied'
        )

        // Submit and verify no language is tracked (null)
        await page.locator('.PostHogSurvey-translation-test-default .ratings-number').first().click()
        await page.locator('.PostHogSurvey-translation-test-default .form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        const surveyEvent = captures.find((c) => c.event === 'survey sent')
        // Should not have $survey_language property when using default
        expect(surveyEvent?.properties.$survey_language).toBeUndefined()
    })

    test('translates multiple choice options correctly', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'translation-test-mcq',
                            name: 'Feature Usage Survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [multipleChoiceQuestionWithTranslations],
                            appearance: { displayThankYouMessage: false },
                        },
                    ],
                },
            })
        })

        await start(
            {
                ...startOptions,
                runBeforePostHogInit: (page) => {
                    page.evaluate(() => {
                        localStorage.setItem(
                            'ph_test token_posthog',
                            JSON.stringify({
                                $stored_person_properties: { language: 'fr' },
                            })
                        )
                    })
                },
            },
            page,
            context
        )

        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-translation-test-mcq').locator('.survey-form')).toBeVisible()

        // Check question text
        await expect(page.locator('.PostHogSurvey-translation-test-mcq .survey-question')).toContainText(
            'Quelles fonctionnalités utilisez-vous?'
        )

        // Check all choices are translated
        const choices = page.locator('.PostHogSurvey-translation-test-mcq .multiple-choice-options label')
        await expect(choices).toHaveCount(4)
        await expect(choices.nth(0)).toContainText('Analytique')
        await expect(choices.nth(1)).toContainText('Relecture de session')
        await expect(choices.nth(2)).toContainText('Indicateurs de fonctionnalités')
        await expect(choices.nth(3)).toContainText('Enquêtes')
    })

    test('translates open text question with button text', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'translation-test-open',
                            name: 'Feedback Survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [openTextQuestionWithTranslations],
                            appearance: { displayThankYouMessage: false },
                        },
                    ],
                },
            })
        })

        await start(
            {
                ...startOptions,
                runBeforePostHogInit: (page) => {
                    page.evaluate(() => {
                        localStorage.setItem(
                            'ph_test token_posthog',
                            JSON.stringify({
                                $stored_person_properties: { language: 'fr' },
                            })
                        )
                    })
                },
            },
            page,
            context
        )

        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-translation-test-open').locator('.survey-form')).toBeVisible()

        // Check question and description
        await expect(page.locator('.PostHogSurvey-translation-test-open .survey-question')).toContainText(
            'Que souhaiteriez-vous améliorer?'
        )
        await expect(page.locator('.PostHogSurvey-translation-test-open .survey-question-description')).toContainText(
            'Partagez vos pensées'
        )

        // Check button text is translated
        await expect(page.locator('.PostHogSurvey-translation-test-open .form-submit')).toContainText('Soumettre')
    })

    test('displays survey in default language when no language is set', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'translation-test-no-lang',
                            name: 'Product Feedback Survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [ratingQuestionWithTranslations],
                            appearance: { displayThankYouMessage: false },
                        },
                    ],
                },
            })
        })

        await start(startOptions, page, context)

        // Don't set any language - should use default (English)
        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-translation-test-no-lang').locator('.survey-form')).toBeVisible()

        // Should display English (default)
        await expect(page.locator('.PostHogSurvey-translation-test-no-lang .survey-question')).toContainText(
            'How satisfied are you with our product?'
        )

        // Submit and verify no language tracking
        await page.locator('.PostHogSurvey-translation-test-no-lang .ratings-number').first().click()
        await page.locator('.PostHogSurvey-translation-test-no-lang .form-submit').click()

        await pollUntilEventCaptured(page, 'survey sent')
        const captures = await page.capturedEvents()
        const surveyEvent = captures.find((c) => c.event === 'survey sent')
        expect(surveyEvent?.properties.$survey_language).toBeUndefined()
    })

    test('handles partial question translation (some fields missing)', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'partial-translation-test',
                            name: 'Product Survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'rating',
                                    display: 'number',
                                    scale: 5,
                                    question: 'How satisfied are you?',
                                    description: 'Please rate us',
                                    lowerBoundLabel: 'Bad',
                                    upperBoundLabel: 'Great',
                                    translations: {
                                        fr: {
                                            question: 'Êtes-vous satisfait?',
                                            // Missing description, lowerBoundLabel, upperBoundLabel
                                        },
                                    },
                                },
                            ],
                            appearance: { displayThankYouMessage: false },
                        },
                    ],
                },
            })
        })

        await start(
            {
                ...startOptions,
                runBeforePostHogInit: (page) => {
                    page.evaluate(() => {
                        localStorage.setItem(
                            'ph_test token_posthog',
                            JSON.stringify({
                                $stored_person_properties: { language: 'fr' },
                            })
                        )
                    })
                },
            },
            page,
            context
        )

        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-partial-translation-test').locator('.survey-form')).toBeVisible()

        // Question should be in French
        await expect(page.locator('.PostHogSurvey-partial-translation-test .survey-question')).toContainText(
            'Êtes-vous satisfait?'
        )

        // Description should fall back to English (missing in French)
        await expect(
            page.locator('.PostHogSurvey-partial-translation-test .survey-question-description')
        ).toContainText('Please rate us')

        // Labels should fall back to English
        await expect(page.locator('.PostHogSurvey-partial-translation-test .rating-text div').first()).toContainText(
            'Bad'
        )
        await expect(page.locator('.PostHogSurvey-partial-translation-test .rating-text div').last()).toContainText(
            'Great'
        )
    })

    test('handles single choice question type', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'single-choice-test',
                            name: 'Single Choice Survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'single_choice',
                                    question: 'Which one do you prefer?',
                                    choices: ['Option 1', 'Option 2', 'Option 3'],
                                    translations: {
                                        fr: {
                                            question: 'Lequel préférez-vous?',
                                            choices: ['Option 1 FR', 'Option 2 FR', 'Option 3 FR'],
                                        },
                                    },
                                },
                            ],
                            appearance: { displayThankYouMessage: false },
                        },
                    ],
                },
            })
        })

        await start(
            {
                ...startOptions,
                runBeforePostHogInit: (page) => {
                    page.evaluate(() => {
                        localStorage.setItem(
                            'ph_test token_posthog',
                            JSON.stringify({
                                $stored_person_properties: { language: 'fr' },
                            })
                        )
                    })
                },
            },
            page,
            context
        )

        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-single-choice-test').locator('.survey-form')).toBeVisible()

        // Question should be in French
        await expect(page.locator('.PostHogSurvey-single-choice-test .survey-question')).toContainText(
            'Lequel préférez-vous?'
        )

        // Should render radio buttons (not checkboxes)
        const radioButtons = page.locator('.PostHogSurvey-single-choice-test input[type="radio"]')
        await expect(radioButtons).toHaveCount(3)

        // Choices should be translated
        const choices = page.locator('.PostHogSurvey-single-choice-test .multiple-choice-options label')
        await expect(choices.nth(0)).toContainText('Option 1 FR')
        await expect(choices.nth(1)).toContainText('Option 2 FR')
    })

    test('handles link question type with translated link text', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'link-question-test',
                            name: 'Link Survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'link',
                                    question: 'Would you like to learn more?',
                                    link: 'https://example.com',
                                    buttonText: 'Learn More',
                                    translations: {
                                        fr: {
                                            question: 'Voulez-vous en savoir plus?',
                                            buttonText: 'En savoir plus',
                                        },
                                    },
                                },
                            ],
                            appearance: { displayThankYouMessage: false },
                        },
                    ],
                },
            })
        })

        await start(
            {
                ...startOptions,
                runBeforePostHogInit: (page) => {
                    page.evaluate(() => {
                        localStorage.setItem(
                            'ph_test token_posthog',
                            JSON.stringify({
                                $stored_person_properties: { language: 'fr' },
                            })
                        )
                    })
                },
            },
            page,
            context
        )

        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-link-question-test').locator('.survey-form')).toBeVisible()

        // Question should be in French
        await expect(page.locator('.PostHogSurvey-link-question-test .survey-question')).toContainText(
            'Voulez-vous en savoir plus?'
        )

        // Button text should be in French
        await expect(page.locator('.PostHogSurvey-link-question-test .form-submit')).toContainText('En savoir plus')
    })

    test('handles HTML content in translated description', async ({ page, context }) => {
        const surveysAPICall = page.route('**/surveys/**', async (route) => {
            await route.fulfill({
                json: {
                    surveys: [
                        {
                            id: 'html-translation-test',
                            name: 'HTML Survey',
                            type: 'popover',
                            start_date: '2021-01-01T00:00:00Z',
                            questions: [
                                {
                                    type: 'rating',
                                    display: 'number',
                                    scale: 5,
                                    question: 'Rate us',
                                    description: 'Please <strong>rate</strong> our service',
                                    descriptionContentType: 'html',
                                    translations: {
                                        fr: {
                                            description: 'Veuillez <strong>évaluer</strong> notre service',
                                        },
                                    },
                                },
                            ],
                            appearance: { displayThankYouMessage: false },
                        },
                    ],
                },
            })
        })

        await start(
            {
                ...startOptions,
                runBeforePostHogInit: (page) => {
                    page.evaluate(() => {
                        localStorage.setItem(
                            'ph_test token_posthog',
                            JSON.stringify({
                                $stored_person_properties: { language: 'fr' },
                            })
                        )
                    })
                },
            },
            page,
            context
        )

        await surveysAPICall

        await expect(page.locator('.PostHogSurvey-html-translation-test').locator('.survey-form')).toBeVisible()

        // Check that HTML is rendered (not escaped)
        const description = page.locator('.PostHogSurvey-html-translation-test .survey-question-description')
        await expect(description).toContainText('évaluer')

        // Check that <strong> tag is actually rendered as HTML
        const strongTag = description.locator('strong')
        await expect(strongTag).toHaveCount(1)
        await expect(strongTag).toContainText('évaluer')
    })
})
