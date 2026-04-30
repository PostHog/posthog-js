import { describe, expect, it } from '@jest/globals'
import { Survey, SurveyQuestionType, SurveyType } from '@posthog/core'
import { applySurveyTranslationForUser, detectUserLanguage } from '../src/surveys/survey-translations'
import { PostHog } from '../src/posthog-rn'

const createBaseSurvey = (): Survey => ({
  id: 'test-survey',
  name: 'Test Survey',
  type: SurveyType.Popover,
  questions: [
    {
      id: 'q1',
      type: SurveyQuestionType.Open,
      question: 'What do you think?',
      originalQuestionIndex: 0,
    },
  ],
  appearance: {
    thankYouMessageHeader: 'Thank you!',
    thankYouMessageDescription: 'We appreciate your feedback',
    thankYouMessageCloseButtonText: 'Close',
  },
})

const createMockPostHog = ({
  overrideLanguage,
  storedPersonProperties,
  locale,
}: {
  overrideLanguage?: string | null
  storedPersonProperties?: unknown
  locale?: string | null
}): PostHog =>
  ({
    getSurveyDisplayLanguageOverride: () => overrideLanguage ?? null,
    getPersistedProperty: jest.fn(() => storedPersonProperties),
    getCommonEventProperties: jest.fn(() => ({ $locale: locale ?? null })),
  }) as unknown as PostHog

describe('react native survey translations', () => {
  it('prioritizes overrideDisplayLanguage over person properties and locale', () => {
    const posthog = createMockPostHog({
      overrideLanguage: 'de',
      storedPersonProperties: { language: 'es' },
      locale: 'fr',
    })

    expect(detectUserLanguage(posthog)).toBe('de')
  })

  it('falls back to person properties and then locale', () => {
    expect(
      detectUserLanguage(
        createMockPostHog({
          storedPersonProperties: { language: 'es' },
          locale: 'fr',
        })
      )
    ).toBe('es')

    expect(
      detectUserLanguage(
        createMockPostHog({
          storedPersonProperties: { some_other_property: 'value' },
          locale: 'pt-BR',
        })
      )
    ).toBe('pt-BR')
  })

  it('applies translated survey copy for the detected user language', () => {
    const posthog = createMockPostHog({ locale: 'pt-BR' })
    const survey = createBaseSurvey()
    survey.translations = {
      pt: {
        name: 'Pesquisa Teste',
        thankYouMessageHeader: 'Obrigado!',
      },
    }
    survey.questions[0].translations = {
      pt: {
        question: 'O que voce acha?',
      },
    }

    const result = applySurveyTranslationForUser(survey, posthog)

    expect(result.survey.name).toBe('Pesquisa Teste')
    expect(result.survey.questions[0].question).toBe('O que voce acha?')
    expect(result.survey.appearance?.thankYouMessageHeader).toBe('Obrigado!')
    expect(result.language).toBe('pt')
  })
})
