export default {
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  modulePathIgnorePatterns: ['<rootDir>/src/__tests__/test-utils/*'],
  collectCoverage: true,
  clearMocks: true,
  fakeTimers: { enableGlobally: false },
  coverageDirectory: 'coverage',
  silent: true,
  verbose: false,
}
