module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node', 'tsx'],
  moduleNameMapper: {
    '^@posthog/core/surveys$': '<rootDir>/../core/src/surveys/index.ts',
  },
  collectCoverage: true,
  clearMocks: true,
  coverageDirectory: 'coverage',
  testPathIgnorePatterns: ['<rootDir>/lib/', 'node_modules', 'examples'],
  fakeTimers: { enableGlobally: true },
  transformIgnorePatterns: [],
}
