import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)
const fromRoot = (relativePath: string): string => fileURLToPath(new URL(relativePath, import.meta.url))

export default defineConfig({
    define: {
        __SURVEY_CSS__: JSON.stringify(readFileSync(fromRoot('../browser-common/src/surveys/survey.css'), 'utf8')),
    },
    resolve: {
        alias: [
            { find: /^@\/(.*)$/, replacement: `${fromRoot('../core/src')}/$1` },
            { find: /^.*\.css$/, replacement: require.resolve('identity-obj-proxy') },
            { find: '@posthog/rrweb-utils', replacement: fromRoot('../rrweb/utils/src/index.ts') },
            { find: /^@posthog\/browser-common$/, replacement: fromRoot('../browser-common/src/index.ts') },
            {
                find: '@posthog/browser-common/feature-flags-config',
                replacement: fromRoot('../browser-common/src/feature-flags-config.ts'),
            },
            {
                find: '@posthog/browser-common/feature-flags',
                replacement: fromRoot('../browser-common/src/feature-flags.ts'),
            },
            {
                find: '@posthog/browser-common/autocapture-config',
                replacement: fromRoot('../browser-common/src/autocapture-config.ts'),
            },
            {
                find: '@posthog/browser-common/autocapture',
                replacement: fromRoot('../browser-common/src/autocapture.ts'),
            },
            { find: '@posthog/browser-common/rageclick', replacement: fromRoot('../browser-common/src/rageclick.ts') },
            {
                find: '@posthog/browser-common/logs-types',
                replacement: fromRoot('../browser-common/src/logs-types.ts'),
            },
            {
                find: '@posthog/browser-common/logs-config',
                replacement: fromRoot('../browser-common/src/logs-config.ts'),
            },
            {
                find: '@posthog/browser-common/console-logs',
                replacement: fromRoot('../browser-common/src/console-logs.ts'),
            },
            { find: '@posthog/browser-common/logs', replacement: fromRoot('../browser-common/src/logs.ts') },
            {
                find: '@posthog/browser-common/surveys-config',
                replacement: fromRoot('../browser-common/src/surveys-config.ts'),
            },
            {
                find: '@posthog/browser-common/surveys-types',
                replacement: fromRoot('../browser-common/src/surveys-types.ts'),
            },
            { find: /^@posthog\/browser-common\/surveys$/, replacement: fromRoot('../browser-common/src/surveys.ts') },
            {
                find: '@posthog/browser-common/surveys-renderer',
                replacement: fromRoot('../browser-common/src/surveys-renderer.tsx'),
            },
            {
                find: /^@posthog\/browser-common\/surveys\/(.*)$/,
                replacement: `${fromRoot('../browser-common/src/surveys')}/$1`,
            },
            { find: '@posthog/browser-common/config', replacement: fromRoot('../browser-common/src/config.ts') },
            { find: '@posthog/browser-common/constants', replacement: fromRoot('../browser-common/src/constants.ts') },
            {
                find: '@posthog/browser-common/extension-runtime',
                replacement: fromRoot('../browser-common/src/extension-runtime.ts'),
            },
            {
                find: '@posthog/browser-common/extension-tokens',
                replacement: fromRoot('../browser-common/src/extension-tokens.ts'),
            },
            { find: '@posthog/browser-common/pubsub', replacement: fromRoot('../browser-common/src/pubsub.ts') },
            {
                find: '@posthog/browser-common/tests/client-conformance',
                replacement: fromRoot('../browser-common/tests/helpers/client-conformance.ts'),
            },
            {
                find: /^@posthog\/browser-common\/utils\/(.*)$/,
                replacement: `${fromRoot('../browser-common/src/utils')}/$1.ts`,
            },
            { find: '@posthog/core/surveys', replacement: fromRoot('../core/src/surveys/index.ts') },
            { find: /^@posthog\/core$/, replacement: fromRoot('../core/src/index.ts') },
        ],
    },
    test: {
        globals: true,
        clearMocks: true,
        environment: 'jsdom',
        environmentOptions: {
            jsdom: {
                url: 'http://localhost/',
            },
        },
        setupFiles: ['./src/__tests__/setup.js'],
        exclude: [
            ...configDefaults.exclude,
            '**/cypress/**',
            '**/react/**',
            '**/test_data/**',
            '**/testcafe/**',
            '**/browser-next-differential/{browser-next-adapter,harness,legacy-browser-adapter,scenarios}.ts',
            'lib/**',
            'src/__tests__/setup.js',
            'src/__tests__/helpers/**',
        ],
    },
})
