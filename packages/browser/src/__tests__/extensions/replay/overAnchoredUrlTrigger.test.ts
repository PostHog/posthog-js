import { mockLogger } from '../../helpers/mock-logger'
import { isOverAnchoredUrlTrigger, URLTriggerMatching } from '../../../extensions/replay/external/triggerMatching'
import { createMockPostHog } from '../../helpers/posthog-instance'
import { SessionRecordingUrlTrigger } from '../../../types'

describe('over-anchored URL trigger detection', () => {
    describe('isOverAnchoredUrlTrigger', () => {
        it.each([
            // over-anchored: anchored both ends, no wildcard/quantifier/alternation
            ['^https://app.2chat.io/$', true],
            ['^https://example.com/$', true],
            ['^https://example.com$', true],
            ['^/checkout$', true],
            // not over-anchored: has a path/query wildcard or repetition
            ['^https://app.2chat.io/.*$', false],
            ['^https://app.2chat.io/.+$', false],
            ['^https://example.com/(login|signup)$', false],
            ['^https://example.com/page?$', false],
            ['^https://example.com/x{2}$', false],
            // not over-anchored: not anchored at both ends (prefix/suffix matches still match many URLs)
            ['^https://example.com/', false],
            ['https://example.com/$', false],
            ['example.com', false],
            // trailing dollar is escaped, so it's a literal `$`, not an end anchor
            ['^https://example.com/price\\$', false],
        ])('%s -> %s', (pattern, expected) => {
            expect(isOverAnchoredUrlTrigger(pattern)).toBe(expected)
        })
    })

    describe('URLTriggerMatching.onConfig warning', () => {
        const configureTriggers = (triggers: SessionRecordingUrlTrigger[]) => {
            const matching = new URLTriggerMatching(createMockPostHog())
            matching.onConfig({ urlTriggers: triggers, urlBlocklist: [] } as any)
            return matching
        }

        beforeEach(() => {
            mockLogger.warn.mockClear()
        })

        it('warns when a URL trigger can only match one exact URL', () => {
            configureTriggers([{ url: '^https://app.2chat.io/$', matching: 'regex' }])

            expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('^https://app.2chat.io/$'))
        })

        it('does not warn for a prefix/wildcard URL trigger', () => {
            configureTriggers([{ url: '^https://app.2chat.io/.*', matching: 'regex' }])

            expect(mockLogger.warn).not.toHaveBeenCalled()
        })
    })
})
