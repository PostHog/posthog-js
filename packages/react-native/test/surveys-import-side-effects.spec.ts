/**
 * Regression test for https://github.com/PostHog/posthog-js/issues/3740
 *
 * The surveys UI is reachable from the package entrypoint, so its modules are
 * evaluated on import. Where `StyleSheet` is undefined (Jest `testEnvironment: node`
 * without the RN preset), a top-level `StyleSheet.create(...)` throws at import.
 * Loading these modules must not call native-only APIs.
 */
describe('surveys import side effects (#3740)', () => {
  const surveyModulesWithStyles: [string, () => Promise<unknown>][] = [
    ['../src/surveys/icons', () => import('../src/surveys/icons')],
    ['../src/surveys/components/Cancel', () => import('../src/surveys/components/Cancel')],
    [
      '../src/surveys/components/ConfirmationMessage',
      () => import('../src/surveys/components/ConfirmationMessage'),
    ],
    ['../src/surveys/components/BottomSection', () => import('../src/surveys/components/BottomSection')],
    ['../src/surveys/components/QuestionTypes', () => import('../src/surveys/components/QuestionTypes')],
    ['../src/surveys/components/SurveyModal', () => import('../src/surveys/components/SurveyModal')],
    ['../src/surveys/components/QuestionHeader', () => import('../src/surveys/components/QuestionHeader')],
  ]

  afterEach(() => {
    vi.doUnmock('react-native')
  })

  it.each(surveyModulesWithStyles)('imports %s without calling native StyleSheet.create', async (_, loadModule) => {
    vi.resetModules()
    // Simulate a runtime where react-native resolves but StyleSheet is unavailable
    // (e.g. a node test environment without the React Native preset).
    vi.doMock('react-native', () => ({ StyleSheet: undefined }))

    await expect(loadModule()).resolves.toBeDefined()
  })
})
