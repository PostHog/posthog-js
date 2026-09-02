/**
 * Regression test for https://github.com/PostHog/posthog-js/issues/3740
 *
 * The surveys UI is reachable from the package entrypoint, so its modules are
 * evaluated on import. Where `StyleSheet` is undefined (Jest `testEnvironment: node`
 * without the RN preset), a top-level `StyleSheet.create(...)` throws at import.
 * Loading these modules must not call native-only APIs.
 */
describe('surveys import side effects (#3740)', () => {
  const surveyModulesWithStyles = [
    '../src/surveys/icons',
    '../src/surveys/components/Cancel',
    '../src/surveys/components/ConfirmationMessage',
    '../src/surveys/components/BottomSection',
    '../src/surveys/components/QuestionTypes',
    '../src/surveys/components/SurveyModal',
    '../src/surveys/components/QuestionHeader',
  ]

  it.each(surveyModulesWithStyles)('imports %s without calling native StyleSheet.create', (modulePath) => {
    jest.isolateModules(() => {
      // Simulate a runtime where react-native resolves but StyleSheet is unavailable
      // (e.g. Jest `testEnvironment: node` without the React Native preset).
      jest.doMock('react-native', () => ({ StyleSheet: undefined }))
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require is required to test import-time side effects under an isolated module registry
      expect(() => require(modulePath)).not.toThrow()
    })
  })
})
