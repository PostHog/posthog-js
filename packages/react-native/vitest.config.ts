import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
    resolve: {
        alias: {
            'react-native': fromRoot('./test/mocks/react-native.ts'),
            'expo-application': fromRoot('./test/mocks/expo-application.ts'),
            'expo-device': fromRoot('./test/mocks/expo-device.ts'),
            'expo-file-system': fromRoot('./test/mocks/expo-file-system.ts'),
            'expo-file-system/legacy': fromRoot('./test/mocks/expo-file-system.ts'),
            'expo-localization': fromRoot('./test/mocks/expo-localization.ts'),
            '@posthog/core/surveys': fromRoot('../core/src/surveys/index.ts'),
        },
    },
    test: {
        globals: true,
        clearMocks: true,
        environment: 'node',
        exclude: [...configDefaults.exclude, 'lib/**', 'examples/**'],
        setupFiles: ['../../tooling/vitest/setup-fake-timers.ts', './test/setup.ts'],
        poolOptions: {
            threads: {
                singleThread: true,
            },
        },
        coverage: {
            enabled: true,
            provider: 'v8',
            reportsDirectory: 'coverage',
        },
    },
})
