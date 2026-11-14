import { describe, expect, it } from 'vitest'
import vm from 'node:vm'
import posthogPlugin from '../src'

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

describe('initialization options', () => {
    it('preserves SDK pageview and pageleave defaults', () => {
        const options = initializationOptions()
        expect(options.capture_pageview).toBeUndefined()
        expect(options.capture_pageleave).toBeUndefined()
    })

    it.each([false, true])('preserves capture_pageview: %s', (capture_pageview) => {
        expect(initializationOptions({ capture_pageview }).capture_pageview).toBe(capture_pageview)
    })
})
