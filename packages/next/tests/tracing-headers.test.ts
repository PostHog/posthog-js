import { readTracingHeaders } from '../src/shared/tracing-headers'

describe('readTracingHeaders', () => {
    describe('with Headers-like object (.get method)', () => {
        it('extracts all three headers', () => {
            const headers = {
                get: (name: string) => {
                    const map: Record<string, string> = {
                        'x-posthog-session-id': 'session-123',
                        'x-posthog-distinct-id': 'user-456',
                        'x-posthog-window-id': 'window-789',
                    }
                    return map[name] ?? null
                },
            }

            expect(readTracingHeaders(headers)).toEqual({
                distinctId: 'user-456',
                sessionId: 'session-123',
                windowId: 'window-789',
            })
        })

        it('returns undefined for missing headers', () => {
            const headers = { get: () => null }

            expect(readTracingHeaders(headers)).toEqual({
                distinctId: undefined,
                sessionId: undefined,
                windowId: undefined,
            })
        })

        it('returns undefined for empty string headers', () => {
            const headers = { get: () => '' }

            expect(readTracingHeaders(headers)).toEqual({
                distinctId: undefined,
                sessionId: undefined,
                windowId: undefined,
            })
        })
    })

    describe('with plain record (IncomingHttpHeaders)', () => {
        it('extracts all three headers', () => {
            const headers: Record<string, string | string[] | undefined> = {
                'x-posthog-session-id': 'session-123',
                'x-posthog-distinct-id': 'user-456',
                'x-posthog-window-id': 'window-789',
            }

            expect(readTracingHeaders(headers)).toEqual({
                distinctId: 'user-456',
                sessionId: 'session-123',
                windowId: 'window-789',
            })
        })

        it('returns undefined for missing headers', () => {
            expect(readTracingHeaders({})).toEqual({
                distinctId: undefined,
                sessionId: undefined,
                windowId: undefined,
            })
        })

        it('takes the first value from string[] headers', () => {
            const headers: Record<string, string | string[] | undefined> = {
                'x-posthog-session-id': ['session-a', 'session-b'],
                'x-posthog-distinct-id': ['user-a'],
                'x-posthog-window-id': 'window-single',
            }

            expect(readTracingHeaders(headers)).toEqual({
                distinctId: 'user-a',
                sessionId: 'session-a',
                windowId: 'window-single',
            })
        })

        it('returns undefined for undefined values', () => {
            const headers: Record<string, string | string[] | undefined> = {
                'x-posthog-session-id': undefined,
                'x-posthog-distinct-id': undefined,
                'x-posthog-window-id': undefined,
            }

            expect(readTracingHeaders(headers)).toEqual({
                distinctId: undefined,
                sessionId: undefined,
                windowId: undefined,
            })
        })
    })
})
