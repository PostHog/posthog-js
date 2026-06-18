import { isDebugMode, isTelemetryEnabled } from '../extensions/consent'

describe('consent', () => {
    describe('isTelemetryEnabled', () => {
        it('is enabled by default', () => {
            expect(isTelemetryEnabled({})).toBe(true)
        })

        it.each(['1', 'true', 'yes'])('honors DO_NOT_TRACK=%p', (value) => {
            expect(isTelemetryEnabled({ DO_NOT_TRACK: value })).toBe(false)
        })

        it.each(['1', 'true'])('honors POSTHOG_CLI_TELEMETRY_DISABLED=%p', (value) => {
            expect(isTelemetryEnabled({ POSTHOG_CLI_TELEMETRY_DISABLED: value })).toBe(false)
        })

        it.each(['0', 'false', ''])('ignores falsy opt-out values (%p)', (value) => {
            expect(isTelemetryEnabled({ DO_NOT_TRACK: value })).toBe(true)
        })

        it('respects an explicit code override of false', () => {
            expect(isTelemetryEnabled({}, false)).toBe(false)
        })

        it('an env opt-out still wins even when override is true', () => {
            expect(isTelemetryEnabled({ DO_NOT_TRACK: '1' }, true)).toBe(false)
        })
    })

    describe('isDebugMode', () => {
        it('is off by default', () => {
            expect(isDebugMode({})).toBe(false)
        })

        it('is on when POSTHOG_CLI_TELEMETRY_DEBUG is truthy', () => {
            expect(isDebugMode({ POSTHOG_CLI_TELEMETRY_DEBUG: '1' })).toBe(true)
        })
    })
})
