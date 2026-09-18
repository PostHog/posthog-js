// @vitest-environment jsdom
/// <reference lib="dom" />

import '../helpers/surveys-setup'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { detectUserLanguage, applySurveyTranslationForUser } from '../../src/surveys/survey-translations'
import { SurveyType, SurveyQuestionType } from '../../src/survey-constants'
import type { Survey } from '../../src/types/surveys'
import { createSurveyRenderContext } from '../helpers/survey-render-context'
import type { MockSurveyRenderContext } from '../helpers/survey-render-context'
import Config from '../../src/config'
import * as commonGlobals from '../../src/utils/globals'

describe('Survey Translations', () => {
    let host: MockSurveyRenderContext
    const originalLanguage = commonGlobals.navigator?.language
    const setBrowserLanguage = (language: string | undefined): void => {
        if (commonGlobals.navigator) {
            Object.defineProperty(commonGlobals.navigator, 'language', {
                value: language,
                writable: true,
                configurable: true,
            })
        }
    }

    beforeEach(() => {
        host = createSurveyRenderContext()
        setBrowserLanguage(undefined)
    })

    afterEach(() => {
        Config.DEBUG = false
        setBrowserLanguage(originalLanguage)
    })

    describe('detectUserLanguage', () => {
        it.each([
            {
                name: 'prioritizes overrideLanguage over all other sources',
                configLanguage: 'de',
                browserLanguage: 'fr',
                storedPersonProperties: { language: 'es' },
                expectedLanguage: 'de',
            },
            {
                name: 'uses person property language when config override is not set',
                configLanguage: null,
                browserLanguage: 'fr',
                storedPersonProperties: { language: 'es' },
                expectedLanguage: 'es',
            },
            {
                name: 'falls back to browser language when config and person language are not available',
                configLanguage: null,
                browserLanguage: 'fr',
                storedPersonProperties: { some_other_property: 'value' },
                expectedLanguage: 'fr',
            },
            {
                name: 'returns null when no language source is available',
                configLanguage: null,
                browserLanguage: undefined,
                storedPersonProperties: { some_other_property: 'value' },
                expectedLanguage: null,
            },
            {
                name: 'trims whitespace from person property language value',
                configLanguage: null,
                browserLanguage: undefined,
                storedPersonProperties: { language: '  es  ' },
                expectedLanguage: 'es',
            },
            {
                name: 'returns null for empty string person property language',
                configLanguage: null,
                browserLanguage: undefined,
                storedPersonProperties: { language: '   ' },
                expectedLanguage: null,
            },
            {
                name: 'handles non-string person property language values',
                configLanguage: null,
                browserLanguage: undefined,
                storedPersonProperties: { language: 123 },
                expectedLanguage: null,
            },
            {
                name: 'falls back to browser language when stored person properties are not available',
                configLanguage: null,
                browserLanguage: 'pt-BR',
                storedPersonProperties: undefined,
                expectedLanguage: 'pt-BR',
            },
        ])('$name', ({ configLanguage, browserLanguage, storedPersonProperties, expectedLanguage }) => {
            host.overrideLanguage = configLanguage
            setBrowserLanguage(browserLanguage)

            host.storedPersonProperties = storedPersonProperties
            expect(detectUserLanguage(host)).toBe(expectedLanguage)
        })

        it('only logs language detection when browser debug logging is enabled', () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
            setBrowserLanguage('en-US')
            host.storedPersonProperties = {}

            try {
                expect(detectUserLanguage(host)).toBe('en-US')
                expect(logSpy).not.toHaveBeenCalled()

                Config.DEBUG = true

                expect(detectUserLanguage(host)).toBe('en-US')
                expect(logSpy).toHaveBeenCalledWith('[PostHog.js] [SurveyTranslations]', 'Using detected locale: en-US')
            } finally {
                logSpy.mockRestore()
            }
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
            host.storedPersonProperties = {}
            const survey = createBaseSurvey()

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey).toEqual(survey)
            expect(result.language).toBeNull()
        })

        it('should return original survey when no translations exist', () => {
            host.storedPersonProperties = { language: 'fr' }
            const survey = createBaseSurvey()

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey).toEqual(survey)
            expect(result.language).toBeNull()
        })

        it('should apply exact match translation', () => {
            host.storedPersonProperties = { language: 'fr' }
            const survey = createBaseSurvey()
            survey.translations = {
                fr: {
                    name: 'Enquête Test',
                },
            }

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey.name).toBe('Enquête Test')
            expect(result.survey.description).toBe('Test Description')
            expect(result.language).toBe('fr')
        })

        it('should apply case-insensitive match', () => {
            host.storedPersonProperties = { language: 'FR' }
            const survey = createBaseSurvey()
            survey.translations = {
                fr: {
                    name: 'Enquête Test',
                },
            }

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey.name).toBe('Enquête Test')
            expect(result.language).toBe('fr')
        })

        it('should fallback to base language for language variants', () => {
            host.storedPersonProperties = { language: 'fr-CA' }
            const survey = createBaseSurvey()
            survey.translations = {
                fr: {
                    name: 'Enquête Française',
                },
            }

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey.name).toBe('Enquête Française')
            expect(result.language).toBe('fr')
        })

        it('should prefer exact match over base language', () => {
            host.storedPersonProperties = { language: 'fr-CA' }
            const survey = createBaseSurvey()
            survey.translations = {
                fr: {
                    name: 'Français Standard',
                },
                'fr-CA': {
                    name: 'Français Canadien',
                },
            }

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey.name).toBe('Français Canadien')
            expect(result.language).toBe('fr-CA')
        })

        it('should apply custom locale keys that are not in a product language list', () => {
            host.overrideLanguage = 'ro-RO'
            const survey = createBaseSurvey()
            survey.translations = {
                'ro-RO': {
                    name: 'Sondaj de feedback',
                    thankYouMessageHeader: 'Multumim!',
                },
            }
            survey.questions[0].translations = {
                'ro-RO': {
                    question: 'Cat de multumit esti?',
                    buttonText: 'Trimite',
                },
            }

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey.name).toBe('Sondaj de feedback')
            expect(result.survey.appearance?.thankYouMessageHeader).toBe('Multumim!')
            expect(result.survey.questions[0].question).toBe('Cat de multumit esti?')
            expect(result.survey.questions[0].buttonText).toBe('Trimite')
            expect(result.language).toBe('ro-RO')
        })

        it.each([
            {
                name: 'question text',
                language: 'es',
                prepareSurvey: (survey: Survey) => {
                    survey.questions[0].translations = {
                        es: {
                            question: '¿Qué piensas?',
                        },
                    }
                },
                assertTranslatedSurvey: (survey: Survey) => {
                    expect(survey.questions[0].question).toBe('¿Qué piensas?')
                },
            },
            {
                name: 'question description',
                language: 'es',
                prepareSurvey: (survey: Survey) => {
                    survey.questions[0].description = 'Please tell us'
                    survey.questions[0].translations = {
                        es: {
                            description: 'Por favor díganos',
                        },
                    }
                },
                assertTranslatedSurvey: (survey: Survey) => {
                    expect(survey.questions[0].description).toBe('Por favor díganos')
                },
            },
            {
                name: 'button text',
                language: 'es',
                prepareSurvey: (survey: Survey) => {
                    survey.questions[0].buttonText = 'Submit'
                    survey.questions[0].translations = {
                        es: {
                            buttonText: 'Enviar',
                        },
                    }
                },
                assertTranslatedSurvey: (survey: Survey) => {
                    expect(survey.questions[0].buttonText).toBe('Enviar')
                },
            },
            {
                name: 'multiple choice options',
                language: 'de',
                prepareSurvey: (survey: Survey) => {
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
                },
                assertTranslatedSurvey: (survey: Survey) => {
                    expect(survey.questions[0].question).toBe('Wählen Sie Optionen')
                    expect((survey.questions[0] as any).choices).toEqual(['Option 1', 'Option 2', 'Option 3'])
                },
            },
            {
                name: 'rating labels',
                language: 'ja',
                prepareSurvey: (survey: Survey) => {
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
                },
                assertTranslatedSurvey: (survey: Survey) => {
                    expect(survey.questions[0].question).toBe('評価してください')
                    expect((survey.questions[0] as any).lowerBoundLabel).toBe('悪い')
                    expect((survey.questions[0] as any).upperBoundLabel).toBe('優秀')
                },
            },
            {
                name: 'link URL',
                language: 'es',
                prepareSurvey: (survey: Survey) => {
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
                },
                assertTranslatedSurvey: (survey: Survey) => {
                    expect(survey.questions[0].question).toBe('Haga clic aquí')
                    expect((survey.questions[0] as any).link).toBe('https://example.com/es')
                },
            },
        ])('should translate $name', ({ language, prepareSurvey, assertTranslatedSurvey }) => {
            host.storedPersonProperties = { language }
            const survey = createBaseSurvey()

            prepareSurvey(survey)
            const result = applySurveyTranslationForUser(survey, host)

            assertTranslatedSurvey(result.survey)
        })

        it('should translate thank you message', () => {
            host.storedPersonProperties = { language: 'pt' }
            const survey = createBaseSurvey()
            survey.translations = {
                pt: {
                    thankYouMessageHeader: 'Obrigado!',
                    thankYouMessageDescription: 'Agradecemos seu feedback',
                    thankYouMessageCloseButtonText: 'Fechar',
                },
            }

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey.appearance?.thankYouMessageHeader).toBe('Obrigado!')
            expect(result.survey.appearance?.thankYouMessageDescription).toBe('Agradecemos seu feedback')
            expect(result.survey.appearance?.thankYouMessageCloseButtonText).toBe('Fechar')
        })

        it('should handle partial translations gracefully', () => {
            host.storedPersonProperties = { language: 'fr' }
            const survey = createBaseSurvey()
            survey.translations = {
                fr: {
                    name: 'Enquête', // Only name translated
                },
            }

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey.name).toBe('Enquête')
            expect(result.survey.description).toBe('Test Description') // Original
        })

        it('should ignore unsupported root translation fields', () => {
            host.storedPersonProperties = { language: 'fr' }
            const survey = createBaseSurvey()
            survey.translations = {
                fr: {
                    description: 'Description traduite',
                },
            } as unknown as Survey['translations']

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey).toEqual(survey)
            expect(result.language).toBeNull()
        })

        it.each([
            {
                name: 'empty question translation',
                translations: {
                    es: {},
                },
            },
            {
                name: 'question translation fields that do not apply to the question type',
                translations: {
                    es: {
                        link: 'https://example.com/es',
                        lowerBoundLabel: 'Malo',
                        upperBoundLabel: 'Excelente',
                        choices: ['Uno', 'Dos'],
                    },
                },
            },
        ])('should ignore $name', ({ translations }) => {
            host.storedPersonProperties = { language: 'es' }
            const survey = createBaseSurvey()
            survey.questions[0].translations = translations

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey).toEqual(survey)
            expect(result.survey.questions[0]).toBe(survey.questions[0])
            expect(result.language).toBeNull()
        })

        it('should translate multiple questions independently', () => {
            host.storedPersonProperties = { language: 'es' }
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

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey.questions[0].question).toBe('Pregunta 1')
            expect(result.survey.questions[1].question).toBe('Pregunta 2')
        })

        it('should not mutate the original survey object', () => {
            host.storedPersonProperties = { language: 'fr' }
            const survey = createBaseSurvey()
            const originalName = survey.name
            survey.translations = {
                fr: {
                    name: 'Nom Traduit',
                },
            }

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey.name).toBe('Nom Traduit')
            expect(survey.name).toBe(originalName) // Original unchanged
        })

        it('should handle surveys without appearance object', () => {
            host.storedPersonProperties = { language: 'fr' }
            const survey = createBaseSurvey()
            survey.appearance = null
            survey.translations = {
                fr: {
                    name: 'Enquête',
                },
            }

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey.name).toBe('Enquête')
            expect(result.survey.appearance).toBeNull()
        })

        it('should track matched language for thank you translations without appearance', () => {
            host.storedPersonProperties = { language: 'fr' }
            const survey = createBaseSurvey()
            survey.appearance = null
            survey.translations = {
                fr: {
                    thankYouMessageHeader: 'Merci!',
                },
            }

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.survey.appearance).toBeNull()
            expect(result.language).toBe('fr')
        })

        it('should return original language code that matched', () => {
            host.storedPersonProperties = { language: 'zh-CN' }
            const survey = createBaseSurvey()
            survey.translations = {
                'zh-CN': {
                    name: '测试调查',
                },
            }

            const result = applySurveyTranslationForUser(survey, host)

            expect(result.language).toBe('zh-CN')
        })
    })
})
