import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@/': fromRoot('../core/src/'),
      './version': fromRoot('./test/mocks/version.ts'),
      'react-native': fromRoot('./test/mocks/react-native.ts'),
      'expo-application': fromRoot('./test/mocks/expo-application.ts'),
      'expo-device': fromRoot('./test/mocks/expo-device.ts'),
      'expo-file-system': fromRoot('./test/mocks/expo-file-system.ts'),
      'expo-file-system/legacy': fromRoot('./test/mocks/expo-file-system.ts'),
      'expo-localization': fromRoot('./test/mocks/expo-localization.ts'),
      '@posthog/core/surveys': fromRoot('../core/src/surveys/index.ts'),
      '@posthog/core': fromRoot('../core/src/index.ts'),
      '@posthog/types': fromRoot('../types/src/index.ts'),
      '@posthog/react-native-plugin/package.json': fromRoot('../react-native-plugin/package.json'),
      '@posthog/react-native-plugin': fromRoot('../react-native-plugin/src/index.ts'),
    },
  },
  test: {
    globals: true,
    clearMocks: true,
    environment: 'node',
    exclude: [...configDefaults.exclude, 'lib/**', 'examples/**'],
    setupFiles: ['../../tooling/vitest/setup-fake-timers.ts', './test/setup.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
})
