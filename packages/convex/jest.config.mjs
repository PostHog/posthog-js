export default {
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  testPathIgnorePatterns: ['setup\\.test\\.ts$'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: './tsconfig.test.json' }],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  clearMocks: true,
}
