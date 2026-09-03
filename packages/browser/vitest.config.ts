import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)
const fromRoot = (relativePath: string): string => fileURLToPath(new URL(relativePath, import.meta.url))

export default defineConfig({
    resolve: {
        alias: [
            { find: /^@\/(.*)$/, replacement: `${fromRoot('../core/src')}/$1` },
            { find: /^.*\.css$/, replacement: require.resolve('identity-obj-proxy') },
            { find: '@posthog/rrweb-utils', replacement: fromRoot('../rrweb/utils/src/index.ts') },
            { find: /^@posthog\/browser-common$/, replacement: fromRoot('../browser-common/src/index.ts') },
            { find: '@posthog/browser-common/config', replacement: fromRoot('../browser-common/src/config.ts') },
            { find: '@posthog/browser-common/constants', replacement: fromRoot('../browser-common/src/constants.ts') },
            {
                find: '@posthog/browser-common/extension-runtime',
                replacement: fromRoot('../browser-common/src/extension-runtime.ts'),
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
