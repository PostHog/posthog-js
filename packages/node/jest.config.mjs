export default {
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  modulePathIgnorePatterns: ['<rootDir>/src/__tests__/utils/*'],
  collectCoverage: true,
  clearMocks: true,
  fakeTimers: { enableGlobally: true },
  coverageDirectory: 'coverage',
  silent: true,
  verbose: false,
}
