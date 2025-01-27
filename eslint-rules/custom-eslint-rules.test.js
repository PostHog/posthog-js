const noDirectNullCheck = require('./no-direct-null-check')
const noDirectUndefinedCheck = require('./no-direct-undefined-check')
const noDirectArrayCheck = require('./no-direct-array-check')
const noDirectIsFunctionCheck = require('./no-direct-function-check')
const noDirectObjectCheck = require('./no-direct-object-check')
const noDirectStringCheck = require('./no-direct-string-check')
const noDirectDateCheck = require('./no-direct-date-check')
const noDirectNumberCheck = require('./no-direct-number-check')
const noDirectBooleanCheck = require('./no-direct-boolean-check')
const noAddEventListener = require('./no-add-event-listener')

const { RuleTester } = require('eslint')

const ruleTester = new RuleTester({
    parserOptions: {
        ecmaVersion: 2015,
        sourceType: 'module',
    },
    env: {
        browser: true,
    },
})

ruleTester.run('no-direct-null-check', noDirectNullCheck, {
    valid: [{ code: `isNull(x)` }],
    invalid: [{ code: `x === null`, errors: [{ message: 'Use isNull() instead of direct null checks.' }] }],
})

ruleTester.run('no-direct-undefined-check', noDirectUndefinedCheck, {
    valid: [{ code: `isUndefined(x)` }],
    invalid: [
        {
            code: `typeof x === undefined`,
            errors: [{ message: 'Use isUndefined() instead of direct undefined checks.' }],
        },
    ],
})

ruleTester.run('no-direct-array-check', noDirectArrayCheck, {
    valid: [{ code: `isArray(x)` }],
    invalid: [
        {
            code: `Array.isArray(x)`,
            errors: [{ message: 'Use isArray() instead of direct array checks.' }],
        },
    ],
})

ruleTester.run('no-direct-is-function-check', noDirectIsFunctionCheck, {
    valid: [{ code: `isFunction(x)` }],
    invalid: [
        {
            code: `/^\\s*\\bfunction\\b/.test(x)`,
            errors: [{ message: 'Do not use regex to check for functions. Use isFunction instead.' }],
        },
        {
            code: `x instanceof Function`,
            errors: [{ message: "Do not use 'instanceof Function' to check for functions. Use isFunction instead." }],
        },
        {
            code: `typeof x === "function"`,
            errors: [
                { message: 'Do not use \'typeof x === "function"\' to check for functions. Use isFunction instead.' },
            ],
        },
    ],
})

ruleTester.run('no-direct-object-check', noDirectObjectCheck, {
    valid: [{ code: `isObject(x)` }],
    invalid: [
        {
            code: `obj === Object(obj)`,
            errors: [{ message: "Do not use 'obj === Object(obj)'. Use isObject instead." }],
        },
    ],
})

ruleTester.run('no-direct-string-check', noDirectStringCheck, {
    valid: [{ code: `isString(x)` }],
    invalid: [
        {
            code: `toString.call(x) == '[object String]'`,
            errors: [{ message: 'Use isString instead of direct string checks.' }],
        },
        {
            code: `x instanceof String`,
            errors: [{ message: 'Use isString instead of direct string checks.' }],
        },
    ],
})

ruleTester.run('no-direct-date-check', noDirectDateCheck, {
    valid: [{ code: `isDate(x)` }],
    invalid: [
        {
            code: `toString.call(obj) == '[object Date]'`,
            errors: [{ message: 'Use isDate instead of direct date checks.' }],
        },
        {
            code: `x instanceof Date`,
            errors: [{ message: 'Use isDate instead of direct date checks.' }],
        },
    ],
})

ruleTester.run('no-direct-number-check', noDirectNumberCheck, {
    valid: [{ code: `isNumber(x)` }],
    invalid: [
        {
            code: `toString.call(obj) == '[object Number]'`,
            errors: [{ message: 'Use isNumber instead of direct number checks.' }],
        },
        {
            code: `typeof x === 'number'`,
            errors: [{ message: 'Use isNumber instead of direct number checks.' }],
        },
    ],
})

ruleTester.run('no-direct-boolean-check', noDirectBooleanCheck, {
    valid: [{ code: `isBoolean(x)` }],
    invalid: [
        {
            code: `toString.call(obj) == '[object Boolean]'`,
            errors: [{ message: 'Use isBoolean instead of direct boolean checks.' }],
        },
        {
            code: `typeof x === 'boolean'`,
            errors: [{ message: 'Use isBoolean instead of direct boolean checks.' }],
        },
    ],
})

ruleTester.run('no-add-event-listener', noAddEventListener, {
    valid: [
        { code: "addEventListener(document, 'click', () => {}, { passive: true })" },
        { code: "addEventListener(window, 'scroll', () => {}, { capture: true, passive: true })" },
    ],
    invalid: [
        {
            code: "document.addEventListener('mouseleave', () => {})",
            errors: [{ message: 'Use addEventListener from @utils instead of calling it directly on elements' }],
            output: "import { addEventListener } from './utils'\naddEventListener(document, 'mouseleave', () => {})",
        },
        {
            code: "element.addEventListener('click', () => {}, true)",
            errors: [{ message: 'Use addEventListener from @utils instead of calling it directly on elements' }],
            output: "import { addEventListener } from './utils'\naddEventListener(element, 'click', () => {}, { capture: true })",
        },
        {
            code: "window.addEventListener('click', () => {}, {})",
            errors: [{ message: 'Use addEventListener from @utils instead of calling it directly on elements' }],
            output: "import { addEventListener } from './utils'\naddEventListener(window, 'click', () => {}, {})",
        },
        {
            code: "document.addEventListener('pageleave', () => {}, { capture: true })",
            errors: [{ message: 'Use addEventListener from @utils instead of calling it directly on elements' }],
            output: "import { addEventListener } from './utils'\naddEventListener(document, 'pageleave', () => {}, { capture: true })",
        },
        {
            code: "document.addEventListener('pageleave', () => {}, { capture: false })",
            errors: [{ message: 'Use addEventListener from @utils instead of calling it directly on elements' }],
            output: "import { addEventListener } from './utils'\naddEventListener(document, 'pageleave', () => {}, { capture: false })",
        },
    ],
})
