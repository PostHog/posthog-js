module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node', 'tsx'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/test/mocks/react-native.ts',
    '^expo-application$': '<rootDir>/test/mocks/expo-application.ts',
    '^expo-device$': '<rootDir>/test/mocks/expo-device.ts',
    '^expo-file-system$': '<rootDir>/test/mocks/expo-file-system.ts',
    '^expo-file-system/legacy$': '<rootDir>/test/mocks/expo-file-system.ts',
    '^expo-localization$': '<rootDir>/test/mocks/expo-localization.ts',
    '^@posthog/core/surveys$': '<rootDir>/../core/src/surveys/index.ts',
  },
  collectCoverage: true,
  clearMocks: true,
  coverageDirectory: 'coverage',
  testPathIgnorePatterns: ['<rootDir>/lib/', 'node_modules', 'examples'],
  fakeTimers: { enableGlobally: true },
  transformIgnorePatterns: [],
}
