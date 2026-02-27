/// <reference lib="dom" />

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { detectUserLanguage, applySurveyTranslationForUser } from '../../utils/survey-translations'
import { Survey, SurveyType, SurveyQuestionType } from '../../posthog-surveys-types'
import { PostHog } from '../../posthog-core'
import { STORED_PERSON_PROPERTIES_KEY } from '../../constants'

describe('Survey Translations', () => {
    let mockPostHog: PostHog
    const originalNavigator = global.navigator

    beforeEach(() => {
        mockPostHog = {
            get_property: jest.fn(),
            config: {},
        } as unknown as PostHog
        
        // Reset navigator mock
        Object.defineProperty(global, 'navigator', {
            value: { language: undefined },
            writable: true,
            configurable: true,
        })
    })

    afterEach(() => {
        // Restore original navigator
        Object.defineProperty(global, 'navigator', {
            value: originalNavigator,
            writable: true,
            configurable: true,
        })
    })

    describe('detectUserLanguage', () => {
        it('should prioritize config.override_display_language over all other sources', () => {
            mockPostHog.config.override_display_language = 'de'
            ;(global.navigator as any).language = 'fr'
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({
                language: 'es',
            })

            const result = detectUserLanguage(mockPostHog)

            expect(result).toBe('de')
        })

        it('should use browser language when config override is not set', () => {
            mockPostHog.config.override_display_language = null
            ;(global.navigator as any).language = 'fr'
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({
                language: 'es',
            })

            const result = detectUserLanguage(mockPostHog)

            expect(result).toBe('fr')
        })

        it('should fall back to person properties when config and browser language are not available', () => {
            mockPostHog.config.override_display_language = null
            ;(global.navigator as any).language = undefined
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({
                language: 'es',
            })

            const result = detectUserLanguage(mockPostHog)

            expect(result).toBe('es')
            expect(mockPostHog.get_property).toHaveBeenCalledWith(STORED_PERSON_PROPERTIES_KEY)
        })

        it('should return null when no language source is available', () => {
            mockPostHog.config.override_display_language = null
            ;(global.navigator as any).language = undefined
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({
                some_other_property: 'value',
            })

            const result = detectUserLanguage(mockPostHog)

            expect(result).toBeNull()
        })

        it('should trim whitespace from person property language value', () => {
            mockPostHog.config.override_display_language = null
            ;(global.navigator as any).language = undefined
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({
                language: '  es  ',
            })

            const result = detectUserLanguage(mockPostHog)

            expect(result).toBe('es')
        })

        it('should return null for empty string person property language', () => {
            mockPostHog.config.override_display_language = null
            ;(global.navigator as any).language = undefined
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({
                language: '   ',
            })

            const result = detectUserLanguage(mockPostHog)

            expect(result).toBeNull()
        })

        it('should handle non-string person property language values', () => {
            mockPostHog.config.override_display_language = null
            ;(global.navigator as any).language = undefined
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({
                language: 123,
            })

            const result = detectUserLanguage(mockPostHog)

            expect(result).toBeNull()
        })
    })

    describe('applySurveyTranslationForUser', () => {
        const createBaseSurvey = (): Survey => ({
            id: 'test-survey',
            name: 'Test Survey',
            description: 'Test Description',
            type: SurveyType.Popover,
            questions: [
                {
                    type: SurveyQuestionType.Open,
                    question: 'What do you think?',
                    id: 'q1',
                },
            ],
            appearance: {
                thankYouMessageHeader: 'Thank you!',
                thankYouMessageDescription: 'We appreciate your feedback',
                thankYouMessageCloseButtonText: 'Close',
            },
            conditions: null,
            start_date: '2024-01-01',
            end_date: null,
            current_iteration: null,
            current_iteration_start_date: null,
            feature_flag_keys: null,
            linked_flag_key: null,
            targeting_flag_key: null,
            internal_targeting_flag_key: null,
        })

        it('should return original survey when no language is detected', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({})
            const survey = createBaseSurvey()

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey).toEqual(survey)
            expect(result.language).toBeNull()
        })

        it('should return original survey when no translations exist', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'fr' })
            const survey = createBaseSurvey()

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey).toEqual(survey)
            expect(result.language).toBeNull()
        })

        it('should apply exact match translation', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'fr' })
            const survey = createBaseSurvey()
            survey.translations = {
                fr: {
                    name: 'Enquête Test',
                    description: 'Description Test',
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.name).toBe('Enquête Test')
            expect(result.survey.description).toBe('Description Test')
            expect(result.language).toBe('fr')
        })

        it('should apply case-insensitive match', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'FR' })
            const survey = createBaseSurvey()
            survey.translations = {
                fr: {
                    name: 'Enquête Test',
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.name).toBe('Enquête Test')
            expect(result.language).toBe('fr')
        })

        it('should fallback to base language for language variants', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'fr-CA' })
            const survey = createBaseSurvey()
            survey.translations = {
                fr: {
                    name: 'Enquête Française',
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.name).toBe('Enquête Française')
            expect(result.language).toBe('fr')
        })

        it('should prefer exact match over base language', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'fr-CA' })
            const survey = createBaseSurvey()
            survey.translations = {
                fr: {
                    name: 'Français Standard',
                },
                'fr-CA': {
                    name: 'Français Canadien',
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.name).toBe('Français Canadien')
            expect(result.language).toBe('fr-CA')
        })

        it('should translate question text', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'es' })
            const survey = createBaseSurvey()
            survey.questions[0].translations = {
                es: {
                    question: '¿Qué piensas?',
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.questions[0].question).toBe('¿Qué piensas?')
        })

        it('should translate question description', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'es' })
            const survey = createBaseSurvey()
            survey.questions[0].description = 'Please tell us'
            survey.questions[0].translations = {
                es: {
                    description: 'Por favor díganos',
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.questions[0].description).toBe('Por favor díganos')
        })

        it('should translate button text', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'es' })
            const survey = createBaseSurvey()
            survey.questions[0].buttonText = 'Submit'
            survey.questions[0].translations = {
                es: {
                    buttonText: 'Enviar',
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.questions[0].buttonText).toBe('Enviar')
        })

        it('should translate multiple choice options', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'de' })
            const survey = createBaseSurvey()
            survey.questions[0] = {
                type: SurveyQuestionType.MultipleChoice,
                question: 'Choose options',
                choices: ['Option 1', 'Option 2', 'Option 3'],
                id: 'q1',
                translations: {
                    de: {
                        question: 'Wählen Sie Optionen',
                        choices: ['Option 1', 'Option 2', 'Option 3'],
                    },
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.questions[0].question).toBe('Wählen Sie Optionen')
            expect((result.survey.questions[0] as any).choices).toEqual(['Option 1', 'Option 2', 'Option 3'])
        })

        it('should translate rating question labels', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'ja' })
            const survey = createBaseSurvey()
            survey.questions[0] = {
                type: SurveyQuestionType.Rating,
                question: 'Rate us',
                scale: 5,
                display: 'number',
                lowerBoundLabel: 'Poor',
                upperBoundLabel: 'Excellent',
                id: 'q1',
                translations: {
                    ja: {
                        question: '評価してください',
                        lowerBoundLabel: '悪い',
                        upperBoundLabel: '優秀',
                    },
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.questions[0].question).toBe('評価してください')
            expect((result.survey.questions[0] as any).lowerBoundLabel).toBe('悪い')
            expect((result.survey.questions[0] as any).upperBoundLabel).toBe('優秀')
        })

        it('should translate link question URL', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'es' })
            const survey = createBaseSurvey()
            survey.questions[0] = {
                type: SurveyQuestionType.Link,
                question: 'Click here',
                link: 'https://example.com/en',
                id: 'q1',
                translations: {
                    es: {
                        question: 'Haga clic aquí',
                        link: 'https://example.com/es',
                    },
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.questions[0].question).toBe('Haga clic aquí')
            expect((result.survey.questions[0] as any).link).toBe('https://example.com/es')
        })

        it('should translate thank you message', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'pt' })
            const survey = createBaseSurvey()
            survey.translations = {
                pt: {
                    thankYouMessageHeader: 'Obrigado!',
                    thankYouMessageDescription: 'Agradecemos seu feedback',
                    thankYouMessageCloseButtonText: 'Fechar',
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.appearance?.thankYouMessageHeader).toBe('Obrigado!')
            expect(result.survey.appearance?.thankYouMessageDescription).toBe('Agradecemos seu feedback')
            expect(result.survey.appearance?.thankYouMessageCloseButtonText).toBe('Fechar')
        })

        it('should handle partial translations gracefully', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'fr' })
            const survey = createBaseSurvey()
            survey.translations = {
                fr: {
                    name: 'Enquête', // Only name translated
                    // description not translated
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.name).toBe('Enquête')
            expect(result.survey.description).toBe('Test Description') // Original
        })

        it('should translate multiple questions independently', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'es' })
            const survey = createBaseSurvey()
            survey.questions = [
                {
                    type: SurveyQuestionType.Open,
                    question: 'Question 1',
                    id: 'q1',
                    translations: {
                        es: {
                            question: 'Pregunta 1',
                        },
                    },
                },
                {
                    type: SurveyQuestionType.Open,
                    question: 'Question 2',
                    id: 'q2',
                    translations: {
                        es: {
                            question: 'Pregunta 2',
                        },
                    },
                },
            ]

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.questions[0].question).toBe('Pregunta 1')
            expect(result.survey.questions[1].question).toBe('Pregunta 2')
        })

        it('should not mutate the original survey object', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'fr' })
            const survey = createBaseSurvey()
            const originalName = survey.name
            survey.translations = {
                fr: {
                    name: 'Nom Traduit',
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.name).toBe('Nom Traduit')
            expect(survey.name).toBe(originalName) // Original unchanged
        })

        it('should handle surveys without appearance object', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'fr' })
            const survey = createBaseSurvey()
            survey.appearance = null
            survey.translations = {
                fr: {
                    name: 'Enquête',
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.survey.name).toBe('Enquête')
            expect(result.survey.appearance).toBeNull()
        })

        it('should return original language code that matched', () => {
            ;(mockPostHog.get_property as jest.Mock).mockReturnValue({ language: 'zh-CN' })
            const survey = createBaseSurvey()
            survey.translations = {
                'zh-CN': {
                    name: '测试调查',
                },
            }

            const result = applySurveyTranslationForUser(survey, mockPostHog)

            expect(result.language).toBe('zh-CN')
        })
    })
})
