import { shouldSkipForVersion } from '../../playwright/compat-skips'

describe('shouldSkipForVersion', () => {
    const capturePayloadTest = 'contains the correct payload after an event'

    it.each(['1.407.1', '1.407.2'])('skips the capture envelope assertion for posthog-js@%s', (version) => {
        expect(shouldSkipForVersion(capturePayloadTest, version)).toContain('Batched capture request envelopes')
    })

    it('runs the capture envelope assertion once the new envelope is published', () => {
        expect(shouldSkipForVersion(capturePayloadTest, '1.407.3')).toBeNull()
    })

    it('does not skip unrelated tests', () => {
        expect(shouldSkipForVersion('captures pageviews, autocapture, and custom events', '1.407.1')).toBeNull()
    })
})
