import type { Mock as VitestMock } from 'vitest'
import { getSurveyRenderContext } from '../browser-surveys'
vi.mock('@posthog/browser-common/utils/logger', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@posthog/browser-common/utils/logger')>()),
    createLogger: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        critical: vi.fn(),
    }),
}))
vi.useFakeTimers()
import { SURVEYS, SURVEYS_REQUEST_TIMEOUT_MS } from '../constants'
import { SurveyManager } from '@posthog/browser-common/surveys-renderer'
import { PostHog, defaultConfig } from '../posthog-core'
import { PostHogPersistence } from '../posthog-persistence'
import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import { MutableFeatureFlagsConfigSource } from '../feature-flags-config'
import { BrowserSurveys } from '../browser-surveys'
import { Survey, SurveyEventName, SurveyType } from '@posthog/browser-common'
import { FlagsResponse } from '../types'
import { assignableWindow } from '../utils/globals'
import { DEFAULT_DISPLAY_SURVEY_OPTIONS, SURVEY_SEEN_PREFIX } from '@posthog/browser-common/utils/survey-utils'
import { createSurveysClient } from './helpers/surveys-client'

const flushPromises = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe('posthog-surveys', () => {
    describe('BrowserSurveys Class', () => {
        let mockPostHog: PostHog & {
            get_property: VitestMock
            _send_request: VitestMock
        }
        let surveys: BrowserSurveys
        let mockGenerateSurveys: VitestMock
        let mockLoadExternalDependency: VitestMock

        const survey: Survey = {
            id: 'completed-survey',
            name: 'completed survey',
            description: 'draft survey description',
            type: SurveyType.Popover,
            linked_flag_key: 'linked-flag-key',
            targeting_flag_key: 'targeting-flag-key',
            internal_targeting_flag_key: 'internal_targeting_flag_key',
            start_date: new Date('10/10/2022').toISOString(),
            conditions: {},
        } as unknown as Survey

        const flagsResponse = {
            featureFlags: {
                'linked-flag-key': true,
                'survey-targeting-flag-key': true,
                'linked-flag-key2': true,
                'survey-targeting-flag-key2': false,
                'enabled-internal-targeting-flag-key': true,
                'disabled-internal-targeting-flag-key': false,
            },
            surveys: true,
        } as unknown as FlagsResponse

        beforeEach(() => {
            // Reset mocks
            vi.clearAllMocks()

            // Clear localStorage
            localStorage.clear()

            // Mock PostHog instance
            mockPostHog = Object.assign(new PostHog(), {
                get_property: vi.fn<Parameters<PostHog['get_property']>, ReturnType<PostHog['get_property']>>(),
                _send_request: vi.fn<Parameters<PostHog['_send_request']>, ReturnType<PostHog['_send_request']>>(),
            })
            mockPostHog.config = {
                ...defaultConfig(),
                persistence: 'memory',
                disable_surveys: false,
                token: 'test-token',
                surveys_request_timeout_ms: SURVEYS_REQUEST_TIMEOUT_MS,
            }
            mockPostHog.persistence = new PostHogPersistence(mockPostHog.config)
            vi.spyOn(mockPostHog.persistence, 'register').mockReturnValue(true)
            vi.spyOn(mockPostHog.requestRouter, 'endpointFor').mockReturnValue('https://test.com/api/surveys')
            vi.spyOn(mockPostHog, 'capture').mockReturnValue(undefined)
            vi.spyOn(mockPostHog, 'is_capturing').mockReturnValue(true)
            vi.spyOn(mockPostHog.consent, 'isOptedIn').mockReturnValue(true)
            vi.spyOn(mockPostHog.consent, 'isOptedOut').mockReturnValue(false)
            vi.spyOn(mockPostHog, 'onFeatureFlags').mockReturnValue(() => {})
            mockPostHog.featureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(mockPostHog.config))
            vi.spyOn(mockPostHog.featureFlags, 'hasLoadedFlags', 'get').mockReturnValue(true)
            vi.spyOn(mockPostHog.featureFlags, 'getFeatureFlag').mockImplementation(
                (key) => flagsResponse.featureFlags[key]
            )
            vi.spyOn(mockPostHog.featureFlags, 'isFeatureEnabled').mockImplementation(
                (key) => !!flagsResponse.featureFlags[key]
            )

            // Create surveys instance
            surveys = new BrowserSurveys(mockPostHog)

            // Mock window.__PosthogExtensions__
            mockGenerateSurveys = vi.fn()
            mockLoadExternalDependency = vi.fn()
            assignableWindow.__PosthogExtensions__ = {
                generateSurveys: mockGenerateSurveys,
                loadExternalDependency: mockLoadExternalDependency,
            }
            surveys.setup(createSurveysClient(mockPostHog))

            surveys.reset()
        })

        afterEach(() => {
            // Clean up
            mockPostHog.persistence?.destroy()
            delete assignableWindow.__PosthogExtensions__
            localStorage.clear()
        })

        describe('displaySurvey', () => {
            let surveyManager: SurveyManager

            beforeEach(() => {
                mockPostHog.get_property.mockReturnValue([survey])
                surveyManager = new SurveyManager(getSurveyRenderContext(mockPostHog as PostHog)!)
                surveys['_surveyManager'] = surveyManager
                flagsResponse.featureFlags[survey.targeting_flag_key] = true
                flagsResponse.featureFlags[survey.internal_targeting_flag_key] = true
                flagsResponse.featureFlags[survey.linked_flag_key] = true
            })

            it.each([true, false])('supports an older surveys bundle when capturing is %s', (capturing) => {
                mockPostHog.is_capturing = vi.fn(() => capturing)
                Object.defineProperty(surveyManager, 'checkSurveyCaptureEligibility', { value: undefined })
                const display = vi.spyOn(surveyManager, 'handlePopoverSurvey').mockImplementation(() => {})

                surveys.displaySurvey(survey.id, { ...DEFAULT_DISPLAY_SURVEY_OPTIONS, ignoreConditions: true })

                expect(display).toHaveBeenCalledTimes(capturing ? 1 : 0)
            })
        })
        describe('getSurveys', () => {
            const mockCallback = vi.fn()
            const mockSurveys = [{ id: 'test-survey' }]

            beforeEach(() => {
                mockCallback.mockClear()
            })

            it('delivers uncached results asynchronously when the legacy transport completes synchronously', async () => {
                mockPostHog._send_request.mockImplementation(({ callback }) => {
                    callback({ statusCode: 200, json: { surveys: mockSurveys } })
                })
                const callback = vi.fn()

                surveys.getSurveys(callback)
                expect(callback).not.toHaveBeenCalled()

                await flushPromises()
                expect(callback).toHaveBeenCalledWith(mockSurveys, { isLoaded: true })
            })

            it('settles dropped requests when the browser client invokes the drop callback', async () => {
                mockPostHog._send_request.mockImplementation(({ callback, fireCallbackOnDrop }) => {
                    if (fireCallbackOnDrop) {
                        callback({ statusCode: 0 })
                    }
                })

                surveys.getSurveys(mockCallback)
                await flushPromises()

                expect(surveys['_getSurveysInFlightPromise']).toBeNull()
                expect(mockCallback).toHaveBeenCalledWith([], {
                    isLoaded: false,
                    error: 'Surveys API could not be loaded, status: 0',
                })
            })

            it('should set correct timeout value in request', () => {
                surveys.getSurveys(mockCallback)

                expect(mockPostHog.requestRouter.endpointFor).toHaveBeenCalledWith(
                    'api',
                    '/api/surveys/?token=test-token'
                )
                expect(mockPostHog._send_request).toHaveBeenCalledWith(
                    expect.objectContaining({
                        timeout: SURVEYS_REQUEST_TIMEOUT_MS,
                        fireCallbackOnDrop: true,
                    })
                )
            })
        })
        describe('handlePageUnload', () => {
            it('does not throw when a stale survey manager is missing handlePageUnload', () => {
                surveys['_surveyManager'] = {} as unknown as SurveyManager

                expect(() => surveys.handlePageUnload()).not.toThrow()
            })
        })

        describe('onActiveMatchingSurveysChanged', () => {
            it('notifies when an event- or action-targeted survey changes, until unsubscribed', () => {
                const captureHooks: Array<(eventName: string, eventPayload?: any) => void> = []
                const eventSurvey: Survey = {
                    ...survey,
                    id: 'event-targeted-survey',
                    type: SurveyType.API,
                    conditions: {
                        events: { values: [{ name: 'user_subscribed' }] },
                        cancelEvents: { values: [{ name: 'user_unsubscribed' }] },
                        actions: {
                            values: [{ id: 1, name: 'account_upgraded', steps: [{ event: 'account_upgraded' }] }],
                        },
                    },
                }
                mockPostHog.get_property.mockImplementation((key: string) =>
                    key === SURVEYS ? [eventSurvey] : undefined
                )
                mockPostHog._addCaptureHook = vi.fn((hook) => {
                    captureHooks.push(hook)
                    return () => {
                        const index = captureHooks.indexOf(hook)
                        if (index !== -1) {
                            captureHooks.splice(index, 1)
                        }
                    }
                })
                mockPostHog.surveys = surveys
                mockPostHog.getSurveys = surveys.getSurveys.bind(surveys)
                mockPostHog.cancelPendingSurvey = vi.fn()
                mockGenerateSurveys.mockImplementation(() => new SurveyManager(getSurveyRenderContext(mockPostHog)!))
                surveys['_isSurveysEnabled'] = true
                const callback = vi.fn()

                const unsubscribe = surveys.onActiveMatchingSurveysChanged(callback)
                surveys.loadIfEnabled()
                const capture = (eventName: string, properties = {}): void => {
                    captureHooks.forEach((hook) => hook(eventName, { event: eventName, properties } as any))
                }

                expect(captureHooks).toHaveLength(3)
                expect(callback).toHaveBeenLastCalledWith([], { isLoaded: true })

                capture('user_subscribed')
                expect(callback).toHaveBeenLastCalledWith([eventSurvey], { isLoaded: true })

                capture('user_subscribed')
                expect(callback).toHaveBeenCalledTimes(2)

                capture('user_unsubscribed')
                expect(callback).toHaveBeenLastCalledWith([], { isLoaded: true })

                capture('account_upgraded')
                expect(callback).toHaveBeenLastCalledWith([eventSurvey], { isLoaded: true })

                capture(SurveyEventName.DISMISSED, { $survey_id: eventSurvey.id })
                expect(callback).toHaveBeenLastCalledWith([], { isLoaded: true })

                unsubscribe()
                capture('user_subscribed')
                expect(callback).toHaveBeenCalledTimes(5)
            })

            it('emits the initial set before a survey-loaded callback can trigger activation', () => {
                const captureHooks: Array<(eventName: string, eventPayload?: any) => void> = []
                const eventSurvey: Survey = {
                    ...survey,
                    id: 'api-event-targeted-survey',
                    type: SurveyType.API,
                    conditions: {
                        events: { values: [{ name: 'my_event' }] },
                    },
                }
                mockPostHog.get_property.mockImplementation((key: string) =>
                    key === SURVEYS ? [eventSurvey] : undefined
                )
                mockPostHog._addCaptureHook = vi.fn((hook) => {
                    captureHooks.push(hook)
                    return () => {}
                })
                mockPostHog.surveys = surveys
                mockPostHog.getSurveys = surveys.getSurveys.bind(surveys)
                mockPostHog.cancelPendingSurvey = vi.fn()
                mockGenerateSurveys.mockImplementation(() => new SurveyManager(getSurveyRenderContext(mockPostHog)!))
                surveys['_isSurveysEnabled'] = true
                const callback = vi.fn()

                surveys.onActiveMatchingSurveysChanged(callback)
                surveys.onSurveysLoaded(() => {
                    captureHooks.forEach((hook) => hook('my_event', { event: 'my_event', properties: {} } as any))
                })
                surveys.loadIfEnabled()

                expect(callback.mock.calls.map(([matchingSurveys]) => matchingSurveys)).toEqual([[], [eventSurvey]])
            })
        })

        describe('markSurveyAsSeen', () => {
            beforeEach(() => {
                localStorage.clear()
            })

            it('marks the survey as seen and records the last seen date', () => {
                surveys.markSurveyAsSeen('abc-123')

                expect(localStorage.getItem(`${SURVEY_SEEN_PREFIX}abc-123`)).toBe('true')
                expect(localStorage.getItem('lastSeenSurveyDate')).not.toBeNull()
            })

            it('includes the iteration in the seen key when provided', () => {
                surveys.markSurveyAsSeen('abc-123', { iteration: 2 })

                expect(localStorage.getItem(`${SURVEY_SEEN_PREFIX}abc-123_2`)).toBe('true')
            })
        })
    })
})
