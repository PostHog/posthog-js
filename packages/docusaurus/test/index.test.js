const assert = require('node:assert/strict')
const test = require('node:test')
const vm = require('node:vm')
const posthogPlugin = require('../src')

function initializationOptions(options = {}) {
    const plugin = posthogPlugin(
        {},
        {
            apiKey: 'phc_test',
            enableInDevelopment: true,
            ...options,
        }
    )
    const script = plugin.injectHtmlTags().headTags.find((tag) => tag.tagName === 'script')
    const context = {
        document: {
            createElement: () => ({}),
            getElementsByTagName: () => [
                {
                    parentNode: { insertBefore() {} },
                },
            ],
        },
    }
    context.window = context
    vm.runInNewContext(script.innerHTML, context)
    return context.posthog._i[0][1]
}

test('preserves SDK pageview and pageleave defaults', () => {
    const options = initializationOptions()
    assert.equal(options.capture_pageview, undefined)
    assert.equal(options.capture_pageleave, undefined)
})

for (const capture_pageview of [false, true]) {
    test(`preserves capture_pageview: ${capture_pageview}`, () => {
        assert.equal(initializationOptions({ capture_pageview }).capture_pageview, capture_pageview)
    })
}
