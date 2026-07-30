import { clearLoggerMocks, mockLogger } from './helpers/mock-logger'
import { window } from '@posthog/browser-common/utils/globals'
import { RateLimiter } from '../rate-limiter'

describe('Rate Limiter', () => {
    let rateLimiter: RateLimiter
    let systemTime: number
    let persistedBucket = {}
    let mockPostHog: any

    const moveTimeForward = (milliseconds: number) => {
        systemTime += milliseconds
        jest.setSystemTime(systemTime)
    }

    const range = (n: number) => Array.from({ length: n }, (_, i) => i)

    beforeEach(() => {
        jest.useFakeTimers()
        jest.spyOn(window!.console, 'error').mockImplementation()

        const baseUTCDateTime = new Date(Date.UTC(2020, 0, 1, 0, 0, 0))
        systemTime = baseUTCDateTime.getTime()
        moveTimeForward(0)

        persistedBucket = {}

        mockPostHog = {
            config: {
                rate_limiting: {
                    events_per_second: 10,
                    events_burst_limit: 100,
                },
            },
            persistence: {
                get_property: jest.fn((key) => persistedBucket[key]),
                set_property: jest.fn((key, value) => {
                    persistedBucket[key] = value
                }),
            },
            capture: jest.fn(),
            get_session_id: jest.fn(() => 'session-id'),
        }

        rateLimiter = new RateLimiter(mockPostHog as any)

        clearLoggerMocks()
    })

    describe('client side', () => {
        it('starts with the max tokens', () => {
            rateLimiter.clientRateLimitContext(true)
            expect(persistedBucket['$capture_rate_limit']).toEqual({
                tokens: 100,
                last: systemTime,
            })
            expect(rateLimiter.clientRateLimitContext().isRateLimited).toBe(false)
        })

        it('subtracts a token with each call', () => {
            range(5).forEach(() => {
                expect(rateLimiter.clientRateLimitContext().isRateLimited).toBe(false)
            })
            expect(persistedBucket['$capture_rate_limit']).toEqual({
                tokens: 95,
                last: systemTime,
            })
        })

        it('adds tokens if time has passed ', () => {
            range(50).forEach(() => {
                expect(rateLimiter.clientRateLimitContext().isRateLimited).toBe(false)
            })
            expect(persistedBucket['$capture_rate_limit']).toEqual({
                tokens: 50,
                last: systemTime,
            })

            moveTimeForward(2000) // 2 seconds = 20 tokens
            expect(rateLimiter.clientRateLimitContext().isRateLimited).toBe(false)
            expect(persistedBucket['$capture_rate_limit']).toEqual({
                tokens: 69, // 50 + 20 - 1
                last: systemTime,
            })
        })

        it('rate limits when past the threshold ', () => {
            range(100).forEach(() => {
                expect(rateLimiter.clientRateLimitContext().isRateLimited).toBe(false)
            })
            range(200).forEach(() => {
                expect(rateLimiter.clientRateLimitContext().isRateLimited).toBe(true)
            })
            expect(persistedBucket['$capture_rate_limit']).toEqual({
                tokens: 0,
                last: systemTime,
                dropped: 199, // the first drop emitted the warning and reset the tally
            })

            moveTimeForward(2000) // 2 seconds = 20 tokens
            expect(rateLimiter.clientRateLimitContext().isRateLimited).toBe(false)
            expect(persistedBucket['$capture_rate_limit']).toEqual({
                tokens: 19, // 20 - 1
                last: systemTime,
                dropped: 199,
            })
        })

        it('refills up to the maximum amount ', () => {
            range(100).forEach(() => {
                expect(rateLimiter.clientRateLimitContext().isRateLimited).toBe(false)
            })
            expect(rateLimiter.clientRateLimitContext().isRateLimited).toBe(true)
            expect(persistedBucket['$capture_rate_limit'].tokens).toEqual(0)

            moveTimeForward(1000000)
            expect(rateLimiter.clientRateLimitContext().isRateLimited).toBe(false)
            expect(persistedBucket['$capture_rate_limit'].tokens).toEqual(99) // limit - 1
        })

        it('captures a rate limit event the first time it is rate limited', () => {
            range(200).forEach(() => {
                rateLimiter.clientRateLimitContext()
            })

            expect(mockPostHog.capture).toBeCalledTimes(1)
            expect(mockPostHog.capture).toHaveBeenCalledWith(
                '$$client_ingestion_warning',
                {
                    $$client_ingestion_warning_message:
                        'posthog-js client rate limited: 1 event(s) dropped since the last warning, triggered on http://localhost/, session session-id. Config is set to 10 events per second and 100 events burst limit.',
                    $$client_ingestion_warning_dropped_events: 1,
                    $$client_ingestion_warning_page: 'http://localhost/',
                    $$client_ingestion_warning_session_id: 'session-id',
                    $$client_ingestion_warning_events_per_second: 10,
                    $$client_ingestion_warning_events_burst_limit: 100,
                },
                {
                    skip_client_rate_limiting: true,
                }
            )
        })

        it('counts events dropped while limited and reports them on the next warning', () => {
            range(200).forEach(() => rateLimiter.clientRateLimitContext())

            // 100 tokens spent, then 100 drops - the first of which triggered the warning and reset the tally
            expect(persistedBucket['$capture_rate_limit'].dropped).toEqual(99)

            mockPostHog.capture.mockClear()

            // recover, then trip the limiter again
            moveTimeForward(1000000)
            range(200).forEach(() => rateLimiter.clientRateLimitContext())

            expect(mockPostHog.capture).toBeCalledTimes(1)
            expect(mockPostHog.capture.mock.calls[0][1]).toMatchObject({
                $$client_ingestion_warning_dropped_events: 100,
            })
            expect(persistedBucket['$capture_rate_limit'].dropped).toEqual(99)
        })

        it('omits the page and session when they are unavailable', () => {
            mockPostHog.get_session_id = jest.fn(() => '')

            range(200).forEach(() => rateLimiter.clientRateLimitContext())

            expect(mockPostHog.capture.mock.calls[0][1].$$client_ingestion_warning_message).toEqual(
                'posthog-js client rate limited: 1 event(s) dropped since the last warning, triggered on http://localhost/. Config is set to 10 events per second and 100 events burst limit.'
            )
        })

        it('does not capture a rate limit event if the persisted config was already rate limited', () => {
            range(200).forEach(() => {
                rateLimiter.clientRateLimitContext()
            })

            expect(mockPostHog.capture).toBeCalledTimes(1)
            mockPostHog.capture.mockClear()

            const newRateLimiter = new RateLimiter(mockPostHog as any)

            range(200).forEach(() => {
                newRateLimiter.clientRateLimitContext()
            })

            expect(mockPostHog.capture).toBeCalledTimes(0)
        })

        it('respects config changes after initialization', () => {
            expect(rateLimiter.captureEventsPerSecond).toBe(10)
            expect(rateLimiter.captureEventsBurstLimit).toBe(100)

            mockPostHog.config.rate_limiting = {
                events_per_second: 5,
                events_burst_limit: 50,
            }

            expect(rateLimiter.captureEventsPerSecond).toBe(5)
            expect(rateLimiter.captureEventsBurstLimit).toBe(50)
        })

        it('uses defaults when config is not set', () => {
            mockPostHog.config.rate_limiting = undefined

            expect(rateLimiter.captureEventsPerSecond).toBe(10)
            expect(rateLimiter.captureEventsBurstLimit).toBe(100)
        })

        it('computes burst limit from events_per_second when only events_per_second is configured', () => {
            mockPostHog.config.rate_limiting = {
                events_per_second: 20,
            }

            expect(rateLimiter.captureEventsPerSecond).toBe(20)
            expect(rateLimiter.captureEventsBurstLimit).toBe(200)
        })

        it('ensures burst limit is at least events_per_second', () => {
            mockPostHog.config.rate_limiting = {
                events_per_second: 50,
                events_burst_limit: 10,
            }

            expect(rateLimiter.captureEventsPerSecond).toBe(50)
            expect(rateLimiter.captureEventsBurstLimit).toBe(50)
        })
    })

    describe('server side', () => {
        it('is not rate limited with no batch key', () => {
            expect(rateLimiter.isServerRateLimited(undefined)).toBe(false)
        })

        it('is not rate limited if there is nothing in persistence', () => {
            expect(rateLimiter.isServerRateLimited('the batch key')).toBe(false)
        })

        it('is not rate limited if there is mo matching batch key in persistence', () => {
            rateLimiter.serverLimits = { 'a different batch key': 1000 }

            expect(rateLimiter.isServerRateLimited('the batch key')).toBe(false)
        })

        it('is not rate limited if the retryAfter is in the past', () => {
            rateLimiter.serverLimits = { 'the batch key': new Date(Date.now() - 1000).getTime() }

            expect(rateLimiter.isServerRateLimited('the batch key')).toBe(false)
        })

        it('is rate limited if the retryAfter is in the future', () => {
            rateLimiter.serverLimits = { 'the batch key': new Date(Date.now() + 1000).getTime() }

            expect(rateLimiter.isServerRateLimited('the batch key')).toBe(true)
        })

        it('sets the events retryAfter on checkForLimiting', () => {
            rateLimiter.checkForLimiting({
                statusCode: 200,
                text: JSON.stringify({ quota_limited: ['events'] }),
            })

            const expectedRetry = new Date().getTime() + 60_000
            expect(rateLimiter.serverLimits).toStrictEqual({ events: expectedRetry })
        })

        it('sets the recordings retryAfter on checkForLimiting', () => {
            rateLimiter.checkForLimiting({
                statusCode: 200,
                text: JSON.stringify({ quota_limited: ['recordings'] }),
            })

            const expectedRetry = new Date().getTime() + 60_000
            expect(rateLimiter.serverLimits).toStrictEqual({ recordings: expectedRetry })
        })

        it('sets multiple retryAfter on checkForLimiting', () => {
            rateLimiter.checkForLimiting({
                statusCode: 200,
                text: JSON.stringify({ quota_limited: ['recordings', 'events', 'mystery'] }),
            })

            const expectedRetry = new Date().getTime() + 60_000
            expect(rateLimiter.serverLimits).toStrictEqual({
                events: expectedRetry,
                recordings: expectedRetry,
                mystery: expectedRetry,
            })
        })

        it('keeps existing batch keys checkForLimiting', () => {
            rateLimiter.checkForLimiting({
                statusCode: 200,
                text: JSON.stringify({ quota_limited: ['events'] }),
            })

            rateLimiter.checkForLimiting({
                statusCode: 200,
                text: JSON.stringify({ quota_limited: ['recordings'] }),
            })

            expect(rateLimiter.serverLimits).toStrictEqual({
                events: expect.any(Number),
                recordings: expect.any(Number),
            })
        })

        it('replaces matching keys', () => {
            rateLimiter.checkForLimiting({
                statusCode: 200,
                text: JSON.stringify({ quota_limited: ['events'] }),
            })

            const firstRetryValue = rateLimiter.serverLimits.events
            jest.advanceTimersByTime(1000)

            rateLimiter.checkForLimiting({
                statusCode: 200,
                text: JSON.stringify({ quota_limited: ['events'] }),
            })

            expect(rateLimiter.serverLimits).toStrictEqual({
                events: firstRetryValue + 1000,
            })
        })

        it('does not set a limit if no limits are present', () => {
            rateLimiter.checkForLimiting({
                statusCode: 200,
                text: JSON.stringify({ quota_limited: [] }),
            })

            expect(rateLimiter.serverLimits).toStrictEqual({})

            rateLimiter.checkForLimiting({
                statusCode: 200,
                text: JSON.stringify({ status: 1 }),
            })

            expect(rateLimiter.serverLimits).toStrictEqual({})
        })

        it('does not log an error when there is an empty body', () => {
            rateLimiter.checkForLimiting({
                statusCode: 200,
                text: '',
            })

            expect(mockLogger.error).not.toHaveBeenCalled()
        })
    })
})
