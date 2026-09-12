import { PostHogPersistedProperty, Survey, SurveyQuestionType, SurveyType } from '@posthog/core'
import type { PostHog } from '../src/posthog-rn'
import { createEventsStorage } from '../src/storage'
import { createSurveyProgress, SurveyProgressStore } from '../src/surveys/survey-progress'

const survey: Survey = {
  id: 'resume',
  name: 'Resume',
  type: SurveyType.Popover,
  start_date: '2026-01-01',
  questions: ['first', 'last'].map((id, originalQuestionIndex) => ({
    id,
    originalQuestionIndex,
    type: SurveyQuestionType.Open,
    question: id,
  })),
}

function setup() {
  const disk = new Map<string, string>()
  const backend = {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      disk.set(key, value)
    },
  }
  function open(project = 'project') {
    const storage = createEventsStorage(backend)
    const client = {
      apiKey: project,
      getPersistedProperty: (key: PostHogPersistedProperty) => storage.getItem(key),
      setPersistedProperty: (key: PostHogPersistedProperty, value: unknown) => storage.setItem(key, value),
    } as unknown as PostHog
    return { storage, store: new SurveyProgressStore(client), client }
  }
  return { open }
}

it('restores answers and display order from a new asynchronous storage instance', async () => {
  const { open } = setup()
  const first = open()
  await first.storage.preloadPromise
  const progress = {
    ...createSurveyProgress(survey),
    questionIndex: 1,
    responses: { $survey_response_first: 'Saved answer' },
    questionSnapshots: { first: 'Original copy' },
  }
  first.store.save(survey, progress)
  await first.storage.waitForPersist()
  const second = open()
  await second.storage.preloadPromise
  expect(second.store.load(survey)).toEqual(progress)
  second.store.remove(survey)
  await second.storage.waitForPersist()
  const third = open()
  await third.storage.preloadPromise
  expect(third.store.load(survey)).toBeUndefined()
  const otherProject = open('different-project')
  await otherProject.storage.preloadPromise
  expect(otherProject.store.load(survey)).toBeUndefined()
})

it.each([
  ['iteration', { ...survey, current_iteration: 2 }],
  ['question removed', { ...survey, questions: survey.questions.slice(1) }],
  ['question reordered', { ...survey, questions: [...survey.questions].reverse() }],
  [
    'response type changed',
    { ...survey, questions: [{ ...survey.questions[0], type: SurveyQuestionType.Rating }, survey.questions[1]] },
  ],
] as const)('does not restore after %s', async (_label, changed) => {
  const { store, storage } = setup().open()
  await storage.preloadPromise
  store.save(survey, createSurveyProgress(survey))
  expect(store.load(changed as Survey)).toBeUndefined()
})

it.each([null, 'bad JSON', {}, [null], [{ project: 'project' }]])('ignores malformed storage %j', async (value) => {
  const { store, storage } = setup().open()
  await storage.preloadPromise
  storage.setItem(PostHogPersistedProperty.SurveysInProgress, value)
  expect(() => store.load(survey)).not.toThrow()
  expect(store.load(survey)).toBeUndefined()
})

it.each([
  { questionIndex: -1 },
  { questionIndex: 2 },
  { questionOrder: [0, 0] },
  { responses: { $survey_response_unknown: 'answer' } },
  { responses: { $survey_response_first: {} } },
  { questionSnapshots: { first: null } },
  { submissionId: '' },
])('rejects incompatible saved progress %j', async (invalid) => {
  const { store, storage } = setup().open()
  await storage.preloadPromise
  store.save(survey, createSurveyProgress(survey))
  const entries = storage.getItem(PostHogPersistedProperty.SurveysInProgress)
  entries[0].progress = { ...entries[0].progress, ...invalid }
  expect(store.load(survey)).toBeUndefined()
})

it('keeps copy edits, but removes expired, ended and deleted survey progress', async () => {
  const { store, storage } = setup().open()
  await storage.preloadPromise
  const progress = createSurveyProgress(survey)
  store.save(survey, progress)
  expect(store.load({ ...survey, questions: survey.questions.map((q) => ({ ...q, question: 'New copy' })) })).toEqual(
    progress
  )
  store.reconcile([{ ...survey, end_date: '2026-01-02' }])
  expect(store.load(survey)).toBeUndefined()
  store.save(survey, progress)
  store.reconcile([])
  expect(store.load(survey)).toBeUndefined()
  store.save(survey, progress)
  vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000)
  expect(store.load(survey)).toBeUndefined()
})

it("bounds storage and does not restore another project's answers", async () => {
  const { open } = setup()
  const { store, storage } = open()
  await storage.preloadPromise
  for (let i = 0; i < 25; i++) store.save({ ...survey, id: `s${i}` }, createSurveyProgress(survey))
  expect(storage.getItem(PostHogPersistedProperty.SurveysInProgress)).toHaveLength(20)
  expect(store.load({ ...survey, id: 's0' })).toBeUndefined()
  expect(store.load({ ...survey, id: 's24' })).toBeDefined()
  await storage.waitForPersist()
  const other = open('other-project')
  await other.storage.preloadPromise
  expect(other.store.load({ ...survey, id: 's24' })).toBeUndefined()
})

it.each([
  [{ type: SurveyQuestionType.SingleChoice, choices: ['A', 'B'] }, { choices: ['B', 'A'] }],
  [{ type: SurveyQuestionType.Rating, scale: 5, display: 'number' }, { scale: 10 }],
  [{ type: SurveyQuestionType.Open }, { branching: { type: 'end' } }],
])('invalidates progress when answer meaning or branching changes', async (question, change) => {
  const { store, storage } = setup().open()
  await storage.preloadPromise
  const original = { ...survey, questions: [{ ...survey.questions[0], ...question }, survey.questions[1]] } as Survey
  store.save(original, createSurveyProgress(original))
  const edited = { ...original, questions: [{ ...original.questions[0], ...change }, original.questions[1]] } as Survey
  expect(store.load(edited)).toBeUndefined()
})
