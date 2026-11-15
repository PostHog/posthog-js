import { describe, expect, it } from 'vitest'
import vm from 'node:vm'
import posthogPlugin from '../src'

function initialization(options = {}) {
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
    return {
        apiKey: context.posthog._i[0][0],
        options: context.posthog._i[0][1],
        script: script.innerHTML,
    }
}

describe('initialization options', () => {
    it('preserves SDK pageview and pageleave defaults', () => {
        const { options } = initialization()
        expect(options.capture_pageview).toBeUndefined()
        expect(options.capture_pageleave).toBeUndefined()
    })

    it.each([false, true])('preserves capture_pageview: %s', (capture_pageview) => {
        expect(initialization({ capture_pageview }).options.capture_pageview).toBe(capture_pageview)
    })

    it('escapes script-closing text in the API key without changing its value', () => {
        const apiKey = 'phc_</ScRiPt><script>window.injected = true</script><!--'
        const result = initialization({ apiKey })

        expect(result.script).not.toMatch(/<\/script/i)
        expect(result.apiKey).toBe(apiKey)
    })

    it('escapes script-closing text in nested options without changing their values', () => {
        const bootstrap = {
            featureFlagPayloads: {
                'test-flag': {
                    html: '</script><script>window.injected = true</script><!--',
                    literal: '\\u003c',
                },
            },
        }
        const result = initialization({ bootstrap })

        expect(result.script).not.toMatch(/<\/script/i)
        expect(result.options.bootstrap).toEqual(bootstrap)
    })
})
