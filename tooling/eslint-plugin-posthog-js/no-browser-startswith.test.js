const noBrowserStartsWith = require('./no-browser-startswith')
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

const errorMessage =
    'Do not use String.prototype.startsWith in the browser SDK — IE11 does not support it. Use indexOf(...) === 0 instead.'

ruleTester.run('no-browser-startswith', noBrowserStartsWith, {
    valid: [
        {
            code: "value.indexOf('prefix') === 0",
            filename: '/project/packages/browser/src/something.ts',
        },
        {
            code: "value.indexOf('prefix') === 0",
            filename: 'packages/browser/src/something.ts',
        },
        {
            code: "value.startsWith('prefix')",
            filename: '/project/packages/browser/src/__tests__/something.test.ts',
        },
        {
            code: "value.startsWith('prefix')",
            filename: '/project/packages/node/src/something.ts',
        },
    ],
    invalid: [
        {
            code: "value.startsWith('prefix')",
            filename: '/project/packages/browser/src/something.ts',
            errors: [{ message: errorMessage }],
        },
        {
            code: "value?.startsWith('prefix')",
            filename: '/project/packages/browser/src/something.ts',
            errors: [{ message: errorMessage }],
        },
    ],
})
