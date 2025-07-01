module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>'],
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json', 'node', 'tsx'],
  collectCoverage: true,
  clearMocks: true,
  coverageDirectory: 'coverage',
  testPathIgnorePatterns: ['<rootDir>/lib/', 'node_modules', 'examples'],
  fakeTimers: { enableGlobally: true },
  transformIgnorePatterns: [],
}
