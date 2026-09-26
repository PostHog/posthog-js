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
import { SURVEYS_REQUEST_TIMEOUT_MS } from '../constants'
import { SurveyManager } from '@posthog/browser-common/surveys-renderer'
import { PostHog } from '../posthog-core'
import { BrowserSurveys } from '../browser-surveys'
import { Survey, SurveyType } from '@posthog/browser-common'
import { FlagsResponse } from '../types'
import { assignableWindow } from '../utils/globals'
import { DEFAULT_DISPLAY_SURVEY_OPTIONS } from '@posthog/browser-common/utils/survey-utils'
import { createMockPostHog } from './helpers/posthog-instance'
import { createSurveysClient } from './helpers/surveys-client'

const flushPromises = async (): Promise<void> => {
    await Promise.resolve()
    await Promise.resolve()
}

describe('posthog-surveys', () => {
    describe('BrowserSurveys Class', () => {
        let mockPostHog: PostHog & {
            get_property: vi.Mock
            _send_request: vi.Mock
        }
        let surveys: BrowserSurveys
        let mockGenerateSurveys: vi.Mock
        let mockLoadExternalDependency: vi.Mock

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
            mockPostHog = createMockPostHog({
                config: {
                    disable_surveys: false,
                    token: 'test-token',
                    surveys_request_timeout_ms: SURVEYS_REQUEST_TIMEOUT_MS,
                },
                persistence: {
                    register: vi.fn(),
                    props: {},
                },
                requestRouter: {
                    endpointFor: vi.fn().mockReturnValue('https://test.com/api/surveys'),
                },
                _send_request: vi.fn(),
                get_property: vi.fn(),
                consent: {
                    _instance: {} as any,
                    _config: {} as any,
                    consent: {} as any,
                    isOptedIn: vi.fn().mockReturnValue(true),
                    isOptedOut: vi.fn().mockReturnValue(false),
                    hasOptedInBefore: vi.fn().mockReturnValue(false),
                    hasOptedOutBefore: vi.fn().mockReturnValue(false),
                    optInCapturing: vi.fn(),
                    optOutCapturing: vi.fn(),
                    reset: vi.fn(),
                    onConsentChange: vi.fn(),
                },
                onFeatureFlags: vi.fn().mockReturnValue(() => {}),
                featureFlags: {
                    onFeatureFlags: vi.fn(() => () => {}),
                    hasLoadedFlags: true,
                    _send_request: vi
                        .fn()
                        .mockImplementation(({ callback }) => callback({ statusCode: 200, json: flagsResponse })),
                    getFeatureFlag: vi
                        .fn()
                        .mockImplementation((featureFlag) => flagsResponse.featureFlags[featureFlag]),
                    isFeatureEnabled: vi
                        .fn()
                        .mockImplementation((featureFlag) => flagsResponse.featureFlags[featureFlag]),
                },
            }) as PostHog & {
                get_property: vi.Mock
                _send_request: vi.Mock
            }

            // Create surveys instance
            surveys = new BrowserSurveys(mockPostHog as PostHog)

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
    })
})
