const noExternalReplayImports = require('./no-external-replay-imports')
const { RuleTester } = require('oxlint/plugins-dev')

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
    },
})

ruleTester.run('no-external-replay-imports', noExternalReplayImports, {
    valid: [
        {
            code: "import { getRecordNetworkPlugin } from '@posthog/browser-common/replay/external/network-plugin'",
            filename: '/project/packages/browser/src/entrypoints/recorder.ts',
        },
        {
            code: "import { getRecordNetworkPlugin } from '@posthog/browser-common/replay/external/network-plugin'",
            filename: '/project/packages/browser-common/src/replay/external/recorder.ts',
        },
        {
            code: "import { LazyLoadedSessionRecording } from '../../src/replay/external/lazy-loaded-session-recorder'",
            filename: '/project/packages/browser-common/tests/replay/lazy-loaded-session-recorder.spec.ts',
        },
        // Allowed imports from entrypoints
        {
            code: "import { something } from '@/extensions/replay/external/denylist'",
            filename: '/project/src/entrypoints/recorder.ts',
        },
        // Allowed imports from the same directory
        {
            code: "import { something } from './external/denylist'",
            filename: '/project/src/extensions/replay/external/other.ts',
        },
        // Allowed imports from the same directory using path alias
        {
            code: "import { something } from '~/extensions/replay/external/denylist'",
            filename: '/project/src/extensions/replay/external/other.ts',
        },
        // Allowed imports from test files
        {
            code: "import { something } from '@/extensions/replay/external/denylist'",
            filename: '/project/src/__tests__/extensions/replay/external/denylist.test.ts',
        },
        // Allowed imports from test files using relative path
        {
            code: "import { something } from '../../../../extensions/replay/external/denylist'",
            filename: '/project/src/__tests__/extensions/replay/external/denylist.test.ts',
        },
        // Allowed imports from playwright specs (also test code)
        {
            code: "import { csrfHeaderCases } from '../../../src/__tests__/extensions/replay/external/test_data/header-cases'",
            filename: '/project/packages/browser/playwright/mocked/session-recording/csrf-headers-preserved.spec.ts',
        },
        // Non-restricted imports should be allowed from anywhere
        {
            code: "import { something } from '@/utils'",
            filename: '/project/src/some/other/file.ts',
        },
    ],
    invalid: [
        {
            code: "import { getRecordNetworkPlugin } from '@posthog/browser-common/replay/external/network-plugin'",
            filename: '/project/packages/browser/src/posthog-core.ts',
            errors: [
                {
                    message:
                        'Lazy replay code can only be imported by lazy replay implementations, SDK entrypoints, test files, or playwright specs',
                },
            ],
        },
        {
            code: "import('@posthog/browser-common/replay/external/network-plugin')",
            filename: '/project/packages/browser/src/posthog-core.ts',
            errors: [
                {
                    message:
                        'Lazy replay code can only be imported by lazy replay implementations, SDK entrypoints, test files, or playwright specs',
                },
            ],
        },
        // Disallowed import from regular source file
        {
            code: "import { something } from '@/extensions/replay/external/denylist'",
            filename: '/project/src/utils/something.ts',
            errors: [
                {
                    message:
                        'Lazy replay code can only be imported by lazy replay implementations, SDK entrypoints, test files, or playwright specs',
                },
            ],
        },
        // Disallowed import using relative path
        {
            code: "import { something } from '../../extensions/replay/external/denylist'",
            filename: '/project/src/utils/something.ts',
            errors: [
                {
                    message:
                        'Lazy replay code can only be imported by lazy replay implementations, SDK entrypoints, test files, or playwright specs',
                },
            ],
        },
        // Disallowed import using path alias
        {
            code: "import { something } from '~/extensions/replay/external/denylist'",
            filename: '/project/src/utils/something.ts',
            errors: [
                {
                    message:
                        'Lazy replay code can only be imported by lazy replay implementations, SDK entrypoints, test files, or playwright specs',
                },
            ],
        },
        // Disallowed dynamic import
        {
            code: "import('../../extensions/replay/external/denylist').then(module => {})",
            filename: '/project/src/utils/something.ts',
            errors: [
                {
                    message:
                        'Lazy replay code can only be imported by lazy replay implementations, SDK entrypoints, test files, or playwright specs',
                },
            ],
        },
    ],
})
