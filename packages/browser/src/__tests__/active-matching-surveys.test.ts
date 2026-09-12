import type { PostHog as PostHogInterface } from '@posthog/types'
import type { ApiResponse } from '@posthog/browser-common'
import { BrowserSurveys } from '../browser-surveys'
import { SURVEYS, SURVEYS_CACHE_TTL_MS, SURVEYS_LOADED_AT } from '../constants'
import { SurveyManager } from '../extensions/surveys'
import type { PostHog } from '../posthog-core'
import { Survey, SurveyEventName, SurveySchedule, SurveyType } from '../posthog-surveys-types'
import type { CaptureResult } from '../types'
import { assignableWindow } from '../utils/globals'
import { createMockConfig, createMockPersistence, createMockPostHog } from './helpers/posthog-instance'
import { createSurveysClient } from './helpers/surveys-client'

const eventSurvey: Survey = {
    id: 'subscription-survey',
    name: 'Subscription survey',
    description: '',
    type: SurveyType.API,
    questions: [],
    linked_flag_key: null,
    targeting_flag_key: null,
    internal_targeting_flag_key: null,
    start_date: '2022-10-10T00:00:00.000Z',
    end_date: null,
    conditions: { events: { values: [{ name: 'activate' }] } },
} as Survey

// Deliberately omit both event-condition keys to exercise action-only API payloads.
const actionSurvey = {
    ...eventSurvey,
    conditions: {
        actions: { values: [{ id: 1, name: 'upgrade', steps: [{ event: 'account_upgraded' }] }] },
    },
} as Survey

const flushRequests = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
        await Promise.resolve()
    }
}

describe('active matching survey subscriptions', () => {
    let surveys: BrowserSurveys
    let posthog: PostHog
    let state: Record<string, any>
    let requests: Array<(response: ApiResponse) => void>
    let captureHooks: Set<Parameters<PostHog['_addCaptureHook']>[0]>
    let flagHooks: Set<Parameters<PostHog['onFeatureFlags']>[0]>
    let sessionHooks: Set<Parameters<PostHog['onSessionId']>[0]>
    let flags: Record<string, boolean>
    let sessionId: string
    let originalExtensions: typeof assignableWindow.__PosthogExtensions__
    let originalUrl: string

    const fixture = (cached: Survey[] | undefined = [eventSurvey], stale = false): void => {
        state = cached ? { [SURVEYS]: cached } : {}
        if (stale) {
            state[SURVEYS_LOADED_AT] = Date.now() - SURVEYS_CACHE_TTL_MS - 1
        }
        requests = []
        captureHooks = new Set()
        flagHooks = new Set()
        sessionHooks = new Set()
        flags = {}
        sessionId = 'session-1'
        posthog = createMockPostHog({
            config: createMockConfig({ disable_surveys: false, capture_pageview: false }),
            persistence: createMockPersistence({
                props: state,
                register: vi.fn((properties) => {
                    Object.assign(state, properties)
                    return true
                }),
                unregister: vi.fn((key) => {
                    delete state[key as string]
                }),
            }),
            get_property: vi.fn((key) => state[key]),
            register: vi.fn((properties) => Object.assign(state, properties)),
            unregister: vi.fn((key) => {
                delete state[key]
            }),
            get_session_id: vi.fn(() => sessionId),
            onSessionId: vi.fn((callback) => {
                sessionHooks.add(callback)
                return () => {
                    sessionHooks.delete(callback)
                }
            }),
            onFeatureFlags: vi.fn((callback) => {
                flagHooks.add(callback)
                return () => {
                    flagHooks.delete(callback)
                }
            }),
            _addCaptureHook: vi.fn((callback) => {
                captureHooks.add(callback)
                return () => {
                    captureHooks.delete(callback)
                }
            }),
            _send_request: vi.fn(({ callback }) => {
                requests.push(callback!)
            }),
            requestRouter: {
                endpointFor: () => 'https://test.com/api/surveys/',
            } as unknown as PostHog['requestRouter'],
            featureFlags: {
                hasLoadedFlags: true,
                isFeatureEnabled: vi.fn((key: string) => flags[key]),
                getFeatureFlag: vi.fn((key: string) => flags[key]),
            } as unknown as PostHog['featureFlags'],
        })
        surveys = new BrowserSurveys(posthog)
        posthog.surveys = surveys
        posthog.getSurveys = surveys.getSurveys.bind(surveys)
        posthog.cancelPendingSurvey = vi.fn()
        assignableWindow.__PosthogExtensions__ = {
            generateSurveys: () => new SurveyManager(posthog),
        }
        surveys.setup(createSurveysClient(posthog))
    }

    const start = (): void => {
        surveys['_isSurveysEnabled'] = true
        surveys.loadIfEnabled()
    }

    const capture = (event: string, properties: Record<string, unknown> = {}): void => {
        const payload = { event, properties } as CaptureResult
        Array.from(captureHooks).forEach((hook) => hook(event, payload))
    }

    const resolveRequest = async (definitions: Survey[], statusCode = 200): Promise<void> => {
        expect(requests).toHaveLength(1)
        requests.shift()!({ statusCode, json: statusCode === 200 ? { surveys: definitions } : undefined })
        await flushRequests()
    }

    beforeEach(() => {
        vi.useFakeTimers()
        originalUrl = window.location.href
        window.history.replaceState({}, '', '/')
        originalExtensions = assignableWindow.__PosthogExtensions__
        localStorage.clear()
    })

    afterEach(() => {
        surveys?.dispose()
        assignableWindow.__PosthogExtensions__ = originalExtensions
        window.history.replaceState({}, '', originalUrl)
        localStorage.clear()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('review regression: does not deliver a pending initial fetch after unsubscribe', async () => {
        fixture(undefined)
        // Explicitly remove the cache: an omitted/default fixture argument normally supplies it.
        delete state[SURVEYS]
        const callback = vi.fn()
        const unsubscribe = surveys.onActiveMatchingSurveysChanged(callback)
        start()
        expect(callback).not.toHaveBeenCalled()
        unsubscribe()
        await resolveRequest([eventSurvey])
        expect(callback).not.toHaveBeenCalled()
    })

    it('review regression: re-evaluates a repeated trigger after the URL changes', () => {
        const restricted = { ...eventSurvey, conditions: { ...eventSurvey.conditions, url: '/checkout' } }
        fixture([restricted])
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        capture('activate')
        expect(callback.mock.lastCall?.[0]).toEqual([])
        window.history.replaceState({}, '', '/checkout')
        capture('activate')
        expect(callback.mock.lastCall?.[0]).toEqual([restricted])
    })

    it.each([SurveyEventName.DISMISSED, SurveyEventName.SENT])(
        'review regression: consumes an action-only survey on %s',
        (event) => {
            fixture([actionSurvey])
            const callback = vi.fn()
            surveys.onActiveMatchingSurveysChanged(callback)
            start()
            capture('account_upgraded')
            expect(callback.mock.lastCall?.[0]).toEqual([actionSurvey])
            capture(SurveyEventName.SHOWN, { $survey_id: actionSurvey.id })
            expect(callback.mock.lastCall?.[0]).toEqual([actionSurvey])
            capture(event, { $survey_id: actionSurvey.id })
            expect(callback.mock.lastCall?.[0]).toEqual([])
        }
    )

    it('review regression: consumes a repeatable action-only survey when shown', () => {
        const repeatable = { ...actionSurvey, schedule: SurveySchedule.Always }
        fixture([repeatable])
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        capture('account_upgraded')
        expect(callback.mock.lastCall?.[0]).toEqual([repeatable])
        capture(SurveyEventName.SHOWN, { $survey_id: repeatable.id })
        expect(callback.mock.lastCall?.[0]).toEqual([])
    })

    it('review regression: removes a survey after a successful background definitions refresh', async () => {
        fixture([eventSurvey], true)
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        capture('activate')
        expect(callback.mock.lastCall?.[0]).toEqual([eventSurvey])
        await resolveRequest([])
        expect(callback.mock.lastCall?.[0]).toEqual([])
        const getter = vi.fn()
        surveys.getActiveMatchingSurveys(getter)
        expect(getter.mock.lastCall?.[0]).toEqual([])
    })

    it('delivers the initial empty result and suppresses unchanged matching results', () => {
        fixture()
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        expect(callback).toHaveBeenCalledWith([], { isLoaded: true })
        capture('activate')
        capture('activate')
        capture('activate')
        expect(callback).toHaveBeenCalledTimes(2)
        expect(callback.mock.lastCall?.[0]).toEqual([eventSurvey])
    })

    it('reports a failed initial fetch and recovers without resubscribing', async () => {
        fixture()
        delete state[SURVEYS]
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        await resolveRequest([], 503)
        expect(callback).toHaveBeenLastCalledWith([], {
            isLoaded: false,
            error: 'Surveys API could not be loaded, status: 503',
        })
        surveys.getSurveys(() => {}, true)
        await resolveRequest([])
        expect(callback).toHaveBeenLastCalledWith([], { isLoaded: true })
        expect(callback).toHaveBeenCalledTimes(2)
    })

    it('reports a failed background refresh without deleting the cached definitions', async () => {
        fixture([eventSurvey], true)
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        capture('activate')
        await resolveRequest([], 503)
        expect(callback.mock.lastCall?.[1]?.isLoaded).toBe(false)
        expect(state[SURVEYS]).toEqual([eventSurvey])
        surveys.getSurveys(() => {}, true)
        await resolveRequest([eventSurvey])
        expect(callback).toHaveBeenLastCalledWith([eventSurvey], { isLoaded: true })
    })

    it('reports script-load failures and survives a later successful initialization', () => {
        fixture([])
        let finishLoad: ((error?: unknown) => void) | undefined
        assignableWindow.__PosthogExtensions__ = {
            loadExternalDependency: (_instance, _kind, callback) => {
                finishLoad = callback
            },
        }
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        expect(finishLoad).toBeDefined()
        finishLoad!(new Error('script unavailable'))
        expect(callback).toHaveBeenLastCalledWith([], {
            isLoaded: false,
            error: 'Could not load surveys script',
        })
        assignableWindow.__PosthogExtensions__ = { generateSurveys: () => new SurveyManager(posthog) }
        surveys.loadIfEnabled()
        expect(callback).toHaveBeenLastCalledWith([], { isLoaded: true })
    })

    it('isolates throwing callbacks during asynchronous delivery', async () => {
        fixture()
        delete state[SURVEYS]
        const broken = vi.fn(() => {
            throw new Error('consumer error')
        })
        const healthy = vi.fn()
        surveys.onActiveMatchingSurveysChanged(broken)
        surveys.onActiveMatchingSurveysChanged(healthy)
        start()
        await resolveRequest([eventSurvey])
        expect(healthy).toHaveBeenCalledTimes(1)
        capture('activate')
        expect(healthy).toHaveBeenLastCalledWith([eventSurvey], { isLoaded: true })
    })

    it('treats repeated registrations of the same callback as independent subscriptions', () => {
        fixture()
        const callback = vi.fn()
        const unsubscribeFirst = surveys.onActiveMatchingSurveysChanged(callback)
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        expect(callback).toHaveBeenCalledTimes(2)
        callback.mockClear()
        unsubscribeFirst()
        unsubscribeFirst()
        capture('activate')
        expect(callback).toHaveBeenCalledTimes(1)
    })

    it('honours unsubscribe during notification of another subscriber', () => {
        fixture()
        const second = vi.fn()
        let unsubscribeSecond = () => {}
        surveys.onActiveMatchingSurveysChanged((matching) => {
            if (matching.length) {
                unsubscribeSecond()
            }
        })
        unsubscribeSecond = surveys.onActiveMatchingSurveysChanged(second)
        start()
        second.mockClear()
        capture('activate')
        expect(second).not.toHaveBeenCalled()
    })

    it('does not deliver stale results after a callback captures a cancelling event', () => {
        const cancellable = {
            ...eventSurvey,
            conditions: { ...eventSurvey.conditions, cancelEvents: { values: [{ name: 'cancel' }] } },
        }
        fixture([cancellable])
        const second = vi.fn()
        surveys.onActiveMatchingSurveysChanged((matching) => {
            if (matching.length) {
                capture('cancel')
            }
        })
        surveys.onActiveMatchingSurveysChanged(second)
        start()
        capture('activate')
        expect(second.mock.calls.map(([matching]) => matching)).toEqual([[]])
    })

    it('does not deliver a pending fetch after disposal or register on a disposed extension', async () => {
        fixture()
        delete state[SURVEYS]
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        surveys.dispose()
        await resolveRequest([eventSurvey])
        surveys.onActiveMatchingSurveysChanged(callback)()
        expect(callback).not.toHaveBeenCalled()
        expect(captureHooks.size).toBe(0)
        expect(flagHooks.size).toBe(0)
        expect(sessionHooks.size).toBe(0)
    })

    it('attaches condition listeners only while subscribed and cleans them up idempotently', () => {
        fixture()
        start()
        const capturesBefore = captureHooks.size
        const flagsBefore = flagHooks.size
        const unsubscribe = surveys.onActiveMatchingSurveysChanged(vi.fn())
        expect(captureHooks.size).toBe(capturesBefore + 1)
        expect(flagHooks.size).toBe(flagsBefore + 1)
        unsubscribe()
        unsubscribe()
        expect(captureHooks.size).toBe(capturesBefore)
        expect(flagHooks.size).toBe(flagsBefore)
        const callback = vi.fn()
        const unsubscribeAgain = surveys.onActiveMatchingSurveysChanged(callback)
        capture('activate')
        expect(callback.mock.lastCall?.[0]).toEqual([eventSurvey])
        unsubscribeAgain()
        expect(captureHooks.size).toBe(capturesBefore)
    })

    it('re-evaluates URL conditions on captured pageviews without another activation event', () => {
        const restricted = { ...eventSurvey, conditions: { ...eventSurvey.conditions, url: '/checkout' } }
        fixture([restricted])
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        capture('activate')
        window.history.replaceState({}, '', '/checkout')
        capture('$pageview')
        expect(callback.mock.lastCall?.[0]).toEqual([restricted])
        window.history.replaceState({}, '', '/')
        capture('$pageview')
        expect(callback.mock.lastCall?.[0]).toEqual([])
    })

    it('re-evaluates feature-flag updates without another activation event', () => {
        const targeted = { ...eventSurvey, linked_flag_key: 'enabled' }
        fixture([targeted])
        flags.enabled = true
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        capture('activate')
        expect(callback.mock.lastCall?.[0]).toEqual([targeted])
        flags.enabled = false
        Array.from(flagHooks).forEach((hook) => hook([], {}))
        expect(callback.mock.lastCall?.[0]).toEqual([])
        flags.enabled = true
        Array.from(flagHooks).forEach((hook) => hook(['enabled'], { enabled: true }))
        expect(callback.mock.lastCall?.[0]).toEqual([targeted])
    })

    it('delivers changed definitions even when the survey IDs are unchanged', async () => {
        fixture()
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        capture('activate')
        const updated = { ...eventSurvey, name: 'Updated survey' }
        surveys.getSurveys(() => {}, true)
        await resolveRequest([updated])
        expect(callback).toHaveBeenLastCalledWith([updated], { isLoaded: true })
        expect(callback).toHaveBeenCalledTimes(3)
    })

    it('notifies when a shown non-repeatable action survey expires with its session', () => {
        fixture([actionSurvey])
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        capture('account_upgraded')
        capture(SurveyEventName.SHOWN, { $survey_id: actionSurvey.id })
        expect(callback.mock.lastCall?.[0]).toEqual([actionSurvey])
        sessionId = 'session-2'
        Array.from(sessionHooks).forEach((hook) => hook(sessionId, 'window-2'))
        expect(callback.mock.lastCall?.[0]).toEqual([])
    })

    it('keeps the existing getter one-shot while a subscription continues updating', () => {
        fixture()
        start()
        const getter = vi.fn()
        const callback = vi.fn()
        surveys.getActiveMatchingSurveys(getter)
        surveys.onActiveMatchingSurveysChanged(callback)
        capture('activate')
        expect(getter).toHaveBeenCalledTimes(1)
        expect(getter).toHaveBeenCalledWith([])
        expect(callback.mock.lastCall?.[0]).toEqual([eventSurvey])
    })

    it('re-evaluates after marking a survey as seen and after reset', () => {
        fixture()
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        start()
        capture('activate')
        surveys.markSurveyAsSeen(eventSurvey.id)
        expect(callback.mock.lastCall?.[0]).toEqual([])
        surveys.reset()
        capture('activate')
        expect(callback.mock.lastCall?.[0]).toEqual([eventSurvey])
    })
    it('exposes load context through the shared public interface', () => {
        fixture()
        const callback = vi.fn()
        const api: Pick<PostHogInterface, 'onActiveMatchingSurveysChanged'> = surveys
        api.onActiveMatchingSurveysChanged((matching, context) => {
            callback(matching, context?.isLoaded, context?.error)
        })
        start()
        expect(callback).toHaveBeenCalledWith([], true, undefined)
    })
})
