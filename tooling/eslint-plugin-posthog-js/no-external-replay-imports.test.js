const noExternalReplayImports = require('./no-external-replay-imports')
const { RuleTester } = require('eslint')

const ruleTester = new RuleTester({
    parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
    },
    env: {
        browser: true,
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
                        'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, or test files',
                },
            ],
        },
        // Disallowed import using relative path
        {
            code: "import { something } from './external/denylist'",
            filename: '/project/src/utils/something.ts',
            errors: [
                {
                    message:
                        'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, or test files',
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
                        'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, or test files',
                },
            ],
        },
        // Disallowed dynamic import
        {
            code: "import('./external/denylist').then(module => {})",
            filename: '/project/src/utils/something.ts',
            errors: [
                {
                    message:
                        'Code from src/extensions/replay/external can only be imported by files in src/extensions/replay/external, src/entrypoints, or test files',
                },
            ],
        },
    ],
})
