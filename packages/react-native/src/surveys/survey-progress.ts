import {
  PostHogPersistedProperty,
  Survey,
  SurveyQuestion,
  SurveyQuestionType,
  SurveyResponses,
  uuidv7,
} from '@posthog/core'
import { getSurveyIterationKey, getSurveyResponseKey } from '@posthog/core/surveys'
import type { PostHog } from '../posthog-rn'
import { getDisplayOrderQuestions } from './survey-shuffling'

export type SurveyProgress = {
  submissionId: string
  questionIndex: number
  questionOrder: number[]
  responses: SurveyResponses
  questionSnapshots: Record<string, string>
  surveyLanguage?: string | null
}

export function createSurveyProgress(survey: Survey): SurveyProgress {
  return {
    submissionId: uuidv7(),
    questionIndex: 0,
    questionOrder: getDisplayOrderQuestions(survey).map((question) => question.originalQuestionIndex),
    responses: {},
    questionSnapshots: {},
  }
}

// Copy changes (including translations) do not invalidate answers. Changes to
// question identity, response shape or branching must start a new submission.
function questionShape(question: SurveyQuestion): object {
  const base = { id: question.id, type: question.type, optional: question.optional, branching: question.branching }
  switch (question.type) {
    case SurveyQuestionType.SingleChoice:
    case SurveyQuestionType.MultipleChoice:
      return { ...base, choices: question.choices, hasOpenChoice: question.hasOpenChoice }
    case SurveyQuestionType.Rating:
      return { ...base, scale: question.scale, display: question.display }
    case SurveyQuestionType.Link:
      return { ...base, link: question.link }
    default:
      return base
  }
}

function surveyShape(survey: Survey): string {
  return JSON.stringify([
    survey.current_iteration_start_date,
    survey.enable_partial_responses,
    survey.appearance?.shuffleQuestions,
    survey.questions.map(questionShape),
  ])
}

type SavedProgress = {
  project: string
  surveyKey: string
  shape: string
  updatedAt: number
  progress: SurveyProgress
}

const MAX_PROGRESS = 20
const MAX_AGE = 30 * 24 * 60 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isQuestionIndex(value: unknown, count: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count
}

function isQuestionOrder(value: unknown, count: number): value is number[] {
  if (!Array.isArray(value) || value.length !== count || new Set(value).size !== count) return false
  return value.every((index) => isQuestionIndex(index, count))
}

function isResponse(value: unknown): boolean {
  if (value === null || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function validResponses(value: unknown, survey: Survey): boolean {
  if (!isRecord(value)) return false
  const keys = new Set(survey.questions.map((question) => getSurveyResponseKey(question.id)))
  return Object.entries(value).every(([key, response]) => keys.has(key) && isResponse(response))
}

function validSnapshots(value: unknown, survey: Survey): boolean {
  if (!isRecord(value)) return false
  const ids = new Set(survey.questions.map((question) => question.id))
  return Object.entries(value).every(([id, text]) => ids.has(id) && typeof text === 'string')
}

function validProgress(value: unknown, survey: Survey): value is SurveyProgress {
  if (!isRecord(value)) return false
  const { submissionId, questionIndex, questionOrder, responses, questionSnapshots, surveyLanguage } = value
  const languageIsValid = surveyLanguage == null || typeof surveyLanguage === 'string'
  return (
    isNonEmptyString(submissionId) &&
    languageIsValid &&
    isQuestionIndex(questionIndex, survey.questions.length) &&
    isQuestionOrder(questionOrder, survey.questions.length) &&
    validResponses(responses, survey) &&
    validSnapshots(questionSnapshots, survey)
  )
}

function isRecent(value: unknown): boolean {
  return typeof value === 'number' && value > Date.now() - MAX_AGE && value <= Date.now()
}

function isSavedProgress(value: unknown, project: string): value is SavedProgress {
  if (!isRecord(value)) return false
  return (
    value.project === project &&
    typeof value.surveyKey === 'string' &&
    isNonEmptyString(value.shape) &&
    isRecent(value.updatedAt) &&
    isRecord(value.progress)
  )
}

export function canCaptureSurvey(posthog: PostHog): boolean {
  return !posthog.optedOut && !posthog.isDisabled
}

export class SurveyProgressStore {
  constructor(private readonly posthog: PostHog) {}

  private read(): SavedProgress[] {
    const raw = this.posthog.getPersistedProperty<unknown>(PostHogPersistedProperty.SurveysInProgress)
    if (!Array.isArray(raw)) return []
    return raw
      .filter((entry): entry is SavedProgress => isSavedProgress(entry, this.posthog.apiKey))
      .slice(0, MAX_PROGRESS)
  }

  load(survey: Survey): SurveyProgress | undefined {
    const entry = this.read().find((entry) => entry.surveyKey === getSurveyIterationKey(survey))
    return entry?.shape === surveyShape(survey) && validProgress(entry.progress, survey) ? entry.progress : undefined
  }

  save(survey: Survey, progress: SurveyProgress): void {
    const surveyKey = getSurveyIterationKey(survey)
    this.posthog.setPersistedProperty(
      PostHogPersistedProperty.SurveysInProgress,
      [
        {
          project: this.posthog.apiKey,
          surveyKey,
          shape: surveyShape(survey),
          updatedAt: Date.now(),
          progress,
        },
        ...this.read().filter((entry) => entry.surveyKey !== surveyKey),
      ].slice(0, MAX_PROGRESS)
    )
  }

  remove(survey: Survey): void {
    this.posthog.setPersistedProperty(
      PostHogPersistedProperty.SurveysInProgress,
      this.read().filter((entry) => entry.surveyKey !== getSurveyIterationKey(survey))
    )
  }

  reconcile(surveys: Survey[]): void {
    const validKeys = new Set(
      surveys.filter((survey) => survey.start_date && !survey.end_date && this.load(survey)).map(getSurveyIterationKey)
    )
    this.posthog.setPersistedProperty(
      PostHogPersistedProperty.SurveysInProgress,
      this.read().filter((entry) => validKeys.has(entry.surveyKey))
    )
  }
}
