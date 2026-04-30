import { describe, expect, it } from '@jest/globals'
import {
  applySurveyTranslation,
  detectSurveyLanguage,
  findBestTranslationMatch,
  getLanguageFromStoredPersonProperties,
} from './translations'
import { Survey, SurveyQuestionType, SurveyType } from '../types'

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
      originalQuestionIndex: 0,
    },
  ],
  appearance: {
    thankYouMessageHeader: 'Thank you!',
    thankYouMessageDescription: 'We appreciate your feedback',
    thankYouMessageCloseButtonText: 'Close',
  },
})

describe('survey translations', () => {
  describe('detectSurveyLanguage', () => {
    it.each([
      {
        name: 'prioritizes override language',
        input: {
          overrideLanguage: 'de',
          storedPersonProperties: { language: 'es' },
          locale: 'fr',
        },
        expected: 'de',
      },
      {
        name: 'uses person language when override is missing',
        input: {
          storedPersonProperties: { language: 'es' },
          locale: 'fr',
        },
        expected: 'es',
      },
      {
        name: 'falls back to locale',
        input: {
          storedPersonProperties: { some_other_property: 'value' },
          locale: 'fr-CA',
        },
        expected: 'fr-CA',
      },
      {
        name: 'returns null when no sources exist',
        input: {
          storedPersonProperties: { some_other_property: 'value' },
        },
        expected: null,
      },
      {
        name: 'trims override language',
        input: {
          overrideLanguage: '  es  ',
        },
        expected: 'es',
      },
    ])('$name', ({ input, expected }) => {
      expect(detectSurveyLanguage(input)).toBe(expected)
    })

    it('reads language from stored person properties', () => {
      expect(getLanguageFromStoredPersonProperties({ language: 'it' })).toBe('it')
      expect(getLanguageFromStoredPersonProperties({ language: '   ' })).toBeNull()
      expect(getLanguageFromStoredPersonProperties({})).toBeNull()
    })
  })

  describe('findBestTranslationMatch', () => {
    it('supports exact and base-language matches', () => {
      expect(findBestTranslationMatch({ fr: {}, 'fr-CA': {} }, 'FR-ca')).toBe('fr-CA')
      expect(findBestTranslationMatch({ fr: {} }, 'fr-CA')).toBe('fr')
      expect(findBestTranslationMatch({ es: {} }, 'de')).toBeNull()
    })
  })

  describe('applySurveyTranslation', () => {
    it('returns original survey when no translations exist', () => {
      const survey = createBaseSurvey()
      const result = applySurveyTranslation(survey, 'fr')

      expect(result.survey).toEqual(survey)
      expect(result.matchedKey).toBeNull()
    })

    it('applies survey-level translations', () => {
      const survey = createBaseSurvey()
      survey.translations = {
        fr: {
          name: 'Enquete Test',
          thankYouMessageHeader: 'Merci',
          thankYouMessageDescription: 'Merci pour votre retour',
          thankYouMessageCloseButtonText: 'Fermer',
        },
      }

      const result = applySurveyTranslation(survey, 'fr')

      expect(result.survey.name).toBe('Enquete Test')
      expect(result.survey.appearance?.thankYouMessageHeader).toBe('Merci')
      expect(result.survey.appearance?.thankYouMessageDescription).toBe('Merci pour votre retour')
      expect(result.survey.appearance?.thankYouMessageCloseButtonText).toBe('Fermer')
      expect(result.matchedKey).toBe('fr')
    })

    it('applies question-level translations', () => {
      const survey = createBaseSurvey()
      survey.questions = [
        {
          type: SurveyQuestionType.Rating,
          question: 'How was it?',
          id: 'q1',
          originalQuestionIndex: 0,
          display: 'number',
          scale: 5,
          lowerBoundLabel: 'Bad',
          upperBoundLabel: 'Great',
          translations: {
            pt: {
              question: 'Como foi?',
              lowerBoundLabel: 'Ruim',
              upperBoundLabel: 'Otimo',
            },
          },
        },
        {
          type: SurveyQuestionType.MultipleChoice,
          question: 'Pick one',
          id: 'q2',
          originalQuestionIndex: 1,
          choices: ['One', 'Other'],
          hasOpenChoice: true,
          translations: {
            pt: {
              choices: ['Um', 'Outro'],
            },
          },
        },
      ]

      const result = applySurveyTranslation(survey, 'pt-BR')

      expect(result.survey.questions[0].question).toBe('Como foi?')
      expect('lowerBoundLabel' in result.survey.questions[0] && result.survey.questions[0].lowerBoundLabel).toBe('Ruim')
      expect('upperBoundLabel' in result.survey.questions[0] && result.survey.questions[0].upperBoundLabel).toBe(
        'Otimo'
      )
      expect('choices' in result.survey.questions[1] && result.survey.questions[1].choices).toEqual(['Um', 'Outro'])
      expect(result.matchedKey).toBe('pt')
    })

    it('uses question-level match when there is no survey-level translation', () => {
      const survey = createBaseSurvey()
      survey.questions[0].translations = {
        de: {
          question: 'Was denkst du?',
        },
      }

      const result = applySurveyTranslation(survey, 'de')

      expect(result.survey.questions[0].question).toBe('Was denkst du?')
      expect(result.matchedKey).toBe('de')
    })

    it('preserves custom survey and question fields for shared consumers', () => {
      const survey = {
        name: 'Custom Survey',
        customSurveyField: true,
        questions: [
          {
            question: 'Pick one',
            customQuestionField: 'native-renderer',
            translations: {
              fr: {
                question: 'Choisissez une option',
              },
            },
          },
        ],
      }

      const result = applySurveyTranslation(survey, 'fr')

      expect(result.survey.customSurveyField).toBe(true)
      expect(result.survey.questions[0].question).toBe('Choisissez une option')
      expect(result.survey.questions[0].customQuestionField).toBe('native-renderer')
      expect(result.matchedKey).toBe('fr')
    })
  })
})
