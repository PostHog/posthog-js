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
        // Shared replay constants and types are allowed from the main bundle
        {
            code: "import { DISABLED } from '@posthog/browser-common/replay/replay-constants'",
            filename: '/project/packages/browser/src/extensions/replay/session-recording.ts',
        },
        {
            code: "import type { SessionRecordingStatus } from '@posthog/browser-common/replay/trigger-matching'",
            filename: '/project/packages/browser/src/utils/globals.ts',
        },
        {
            code: "import { type eventWithTime } from '@posthog/browser-common/replay/rrweb-types'",
            filename: '/project/packages/browser/src/utils/globals.ts',
        },
        // Shared replay modules are allowed in the lazy recorder and entrypoints
        {
            code: "import { MutationThrottler } from '@posthog/browser-common/replay/mutation-throttler'",
            filename: '/project/packages/browser/src/extensions/replay/external/lazy-loaded-session-recorder.ts',
        },
        // Packages that own the shared replay modules are not restricted by this rule
        {
            code: "import { getRecordNetworkPlugin } from '@posthog/browser-common/replay/network-plugin'",
            filename: '/project/packages/browser-next/src/products/session-recording/recorder.ts',
        },
        // Non-restricted imports should be allowed from anywhere
        {
            code: "import { something } from '@/utils'",
            filename: '/project/src/some/other/file.ts',
        },
    ],
    invalid: [
        // Disallowed import from regular source file
        {
            code: "import { something } from '@/extensions/replay/external/denylist'",
            filename: '/project/src/utils/something.ts',
            errors: [
                {
                    message:
                        'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, test files, or playwright specs',
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
                        'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, test files, or playwright specs',
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
                        'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, test files, or playwright specs',
                },
            ],
        },
        // Disallowed value import of a shared replay module from the main bundle
        {
            code: "import { URLTriggerMatching } from '@posthog/browser-common/replay/trigger-matching'",
            filename: '/project/packages/browser/src/utils/something.ts',
            errors: [
                {
                    message:
                        'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, test files, or playwright specs',
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
                        'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, test files, or playwright specs',
                },
            ],
        },
    ],
})
