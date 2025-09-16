export default {
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverage: true,
  clearMocks: true,
  fakeTimers: { enableGlobally: true },
  coverageDirectory: 'coverage',
  silent: true,
  verbose: false,
}
