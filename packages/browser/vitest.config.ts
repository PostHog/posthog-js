import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)
const preactRoot = path.resolve(require.resolve('preact'), '../..')
const testingLibraryPreactCjs = path.dirname(require.resolve('@testing-library/preact'))
const fromRoot = (relativePath: string): string => fileURLToPath(new URL(relativePath, import.meta.url))

export default defineConfig({
    resolve: {
        alias: [
            { find: /\.css$/, replacement: require.resolve('identity-obj-proxy') },
            { find: 'preact', replacement: path.join(preactRoot, 'dist/preact.js') },
            { find: 'preact/hooks', replacement: path.join(preactRoot, 'hooks/dist/hooks.js') },
            { find: 'preact/jsx-runtime', replacement: path.join(preactRoot, 'jsx-runtime/dist/jsxRuntime.js') },
            { find: 'preact/test-utils', replacement: path.join(preactRoot, 'test-utils/dist/testUtils.js') },
            { find: '@testing-library/preact', replacement: path.join(testingLibraryPreactCjs, 'index.js') },
            { find: '@posthog/rrweb-utils', replacement: fromRoot('../rrweb/utils/src/index.ts') },
            { find: '@posthog/browser-common', replacement: fromRoot('../browser-common/src/index.ts') },
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
        ],
    },
    test: {
        globals: true,
        clearMocks: true,
        environment: 'jsdom',
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
        deps: {
            inline: [/query-selector-shadow-dom/, /@testing-library\/preact/, /preact/],
        },
    },
})
