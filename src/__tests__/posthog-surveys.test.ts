/* eslint-disable compat/compat */
jest.mock('../utils/logger', () => ({
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}))
jest.useFakeTimers()

import { SURVEYS, SURVEYS_REQUEST_TIMEOUT_MS } from '../constants'
import { PostHog } from '../posthog-core'
import { PostHogSurveys } from '../posthog-surveys'
import { assignableWindow, window } from '../utils/globals'
import { doesSurveyUrlMatch } from '../utils/survey-utils'

describe('posthog-surveys', () => {
    describe('PostHogSurveys Class', () => {
        let mockPostHog: PostHog & {
            get_property: jest.Mock
            _send_request: jest.Mock
        }
        let surveys: PostHogSurveys
        let mockGenerateSurveys: jest.Mock
        let mockLoadExternalDependency: jest.Mock

        beforeEach(() => {
            // Reset mocks
            jest.clearAllMocks()

            // Mock PostHog instance
            mockPostHog = {
                config: {
                    disable_surveys: false,
                    token: 'test-token',
                    surveys_request_timeout_ms: SURVEYS_REQUEST_TIMEOUT_MS,
                },
                persistence: {
                    register: jest.fn(),
                    props: {},
                },
                requestRouter: {
                    endpointFor: jest.fn().mockReturnValue('https://test.com/api/surveys'),
                },
                _send_request: jest.fn(),
                get_property: jest.fn(),
            } as unknown as PostHog & {
                get_property: jest.Mock
                _send_request: jest.Mock
            }

            // Create surveys instance
            surveys = new PostHogSurveys(mockPostHog as PostHog)

            // Mock window.__PosthogExtensions__
            mockGenerateSurveys = jest.fn()
            mockLoadExternalDependency = jest.fn()
            assignableWindow.__PosthogExtensions__ = {
                generateSurveys: mockGenerateSurveys,
                loadExternalDependency: mockLoadExternalDependency,
            }
        })

        afterEach(() => {
            // Clean up
            delete assignableWindow.__PosthogExtensions__
        })

        describe('loadIfEnabled', () => {
            it('should not initialize if surveys are already loaded', () => {
                // Set surveyManager to simulate already loaded state
                surveys['_surveyManager'] = {}
                surveys.loadIfEnabled()

                expect(mockGenerateSurveys).not.toHaveBeenCalled()
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should not initialize if already initializing', () => {
                // Set isInitializingSurveys to true
                surveys['_isInitializingSurveys'] = true
                surveys.loadIfEnabled()

                expect(mockGenerateSurveys).not.toHaveBeenCalled()
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should not initialize if surveys are disabled', () => {
                mockPostHog.config.disable_surveys = true
                surveys.loadIfEnabled()

                expect(mockGenerateSurveys).not.toHaveBeenCalled()
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should not initialize if PostHog Extensions are not found', () => {
                delete assignableWindow.__PosthogExtensions__
                surveys.loadIfEnabled()

                expect(mockGenerateSurveys).not.toHaveBeenCalled()
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should not initialize if decide server response is not ready', () => {
                surveys.loadIfEnabled()

                expect(mockGenerateSurveys).not.toHaveBeenCalled()
                expect(mockLoadExternalDependency).not.toHaveBeenCalled()
            })

            it('should set isInitializingSurveys to false after successful initialization', () => {
                // Set decide server response
                surveys['_hasSurveys'] = true
                mockGenerateSurveys.mockReturnValue({})

                surveys.loadIfEnabled()

                expect(surveys['_isInitializingSurveys']).toBe(false)
            })

            it('should set isInitializingSurveys to false after failed initialization', () => {
                // Set decide server response
                surveys['_hasSurveys'] = true
                mockGenerateSurveys.mockImplementation(() => {
                    throw new Error('Test error')
                })

                expect(() => surveys.loadIfEnabled()).toThrow('Test error')
                expect(surveys['_isInitializingSurveys']).toBe(false)
            })

            it('should set isInitializingSurveys to false when loadExternalDependency fails', () => {
                // Set decide server response but no generateSurveys
                surveys['_hasSurveys'] = true
                mockGenerateSurveys = undefined
                assignableWindow.__PosthogExtensions__.generateSurveys = undefined

                mockLoadExternalDependency.mockImplementation((_instance, _type, callback) => {
                    callback(new Error('Failed to load'))
                })

                surveys.loadIfEnabled()

                expect(surveys['_isInitializingSurveys']).toBe(false)
            })

            it('should call the callback with the surveys when they are loaded', () => {
                surveys['_hasSurveys'] = true
                mockGenerateSurveys.mockReturnValue({})
                const callback = jest.fn()
                const mockSurveys = [{ id: 'test-survey' }]
                mockPostHog.get_property.mockReturnValue(mockSurveys)

                surveys.onSurveysLoaded(callback)
                surveys.loadIfEnabled()

                expect(surveys['_isInitializingSurveys']).toBe(false)
                expect(callback).toHaveBeenCalledWith(mockSurveys, {
                    isLoaded: true,
                })
                expect(callback).toHaveBeenCalledTimes(1)

                surveys.loadIfEnabled()
                // callback is only called once, even if surveys are loaded again
                expect(callback).toHaveBeenCalledTimes(1)
            })

            it('should call the callback with an error when surveys are not loaded', () => {
                surveys['_hasSurveys'] = true
                mockGenerateSurveys.mockImplementation(() => {
                    throw new Error('Error initializing surveys')
                })
                const callback = jest.fn()

                surveys.onSurveysLoaded(callback)
                expect(() => surveys.loadIfEnabled()).toThrow('Error initializing surveys')

                expect(surveys['_isInitializingSurveys']).toBe(false)
                expect(callback).toHaveBeenCalledWith([], {
                    isLoaded: false,
                    error: 'Error initializing surveys',
                })
                expect(callback).toHaveBeenCalledTimes(1)

                // callback is only called once, even if surveys are loaded again
                expect(callback).toHaveBeenCalledTimes(1)
            })
        })

        describe('getSurveys', () => {
            const mockCallback = jest.fn()
            const mockSurveys = [{ id: 'test-survey' }]

            beforeEach(() => {
                mockCallback.mockClear()
            })

            it('should return cached surveys and not fetch if they exist', () => {
                mockPostHog.get_property.mockReturnValue(mockSurveys)

                surveys.getSurveys(mockCallback)

                expect(mockPostHog._send_request).not.toHaveBeenCalled()
                expect(mockCallback).toHaveBeenCalledWith(mockSurveys, {
                    isLoaded: true,
                })
                expect(surveys['_isFetchingSurveys']).toBe(false)
            })

            it('should not make concurrent API calls', () => {
                surveys['_isFetchingSurveys'] = true

                surveys.getSurveys(mockCallback)

                expect(mockPostHog._send_request).not.toHaveBeenCalled()
                expect(mockCallback).toHaveBeenCalledWith([], {
                    isLoaded: false,
                    error: 'Surveys are already being loaded',
                })
            })

            it('should reset _isFetchingSurveys after successful API call', () => {
                mockPostHog._send_request.mockImplementation(({ callback }) => {
                    callback({ statusCode: 200, json: { surveys: mockSurveys } })
                })

                surveys.getSurveys(mockCallback)

                expect(surveys['_isFetchingSurveys']).toBe(false)
                expect(mockCallback).toHaveBeenCalledWith(mockSurveys, {
                    isLoaded: true,
                })
                expect(mockPostHog.persistence?.register).toHaveBeenCalledWith({ [SURVEYS]: mockSurveys })
            })

            it('should reset _isFetchingSurveys after failed API call (non-200 status)', () => {
                mockPostHog._send_request.mockImplementation(({ callback }) => {
                    callback({ statusCode: 500 })
                })

                surveys.getSurveys(mockCallback)

                expect(surveys['_isFetchingSurveys']).toBe(false)
                expect(mockCallback).toHaveBeenCalledWith([], {
                    isLoaded: false,
                    error: 'Surveys API could not be loaded, status: 500',
                })
            })

            it('should reset _isFetchingSurveys when API call throws error', () => {
                mockPostHog._send_request.mockImplementation(() => {
                    throw new Error('Network error')
                })

                expect(() => surveys.getSurveys(mockCallback)).toThrow('Network error')
                expect(surveys['_isFetchingSurveys']).toBe(false)
            })

            it('should reset _isFetchingSurveys when request times out', () => {
                // Mock a request that will timeout
                mockPostHog._send_request.mockImplementation(({ callback }) => {
                    // Simulate a timeout by calling callback with status 0
                    callback({ statusCode: 0, text: 'timeout' })
                })

                surveys.getSurveys(mockCallback)

                expect(surveys['_isFetchingSurveys']).toBe(false)
                expect(mockCallback).toHaveBeenCalledWith([], {
                    isLoaded: false,
                    error: 'Surveys API could not be loaded, status: 0',
                })
            })

            it('should handle delayed successful responses correctly', () => {
                const delayedSurveys = [{ id: 'delayed-survey' }]

                // Mock a request that takes some time to respond
                mockPostHog._send_request.mockImplementation(({ callback }) => {
                    setTimeout(() => {
                        callback({
                            statusCode: 200,
                            json: { surveys: delayedSurveys },
                        })
                    }, 100)
                })

                surveys.getSurveys(mockCallback)

                // Initially the flag should be true
                expect(surveys['_isFetchingSurveys']).toBe(true)

                // After the response comes in
                jest.advanceTimersByTime(100)

                expect(surveys['_isFetchingSurveys']).toBe(false)
                expect(mockCallback).toHaveBeenCalledWith(delayedSurveys, {
                    isLoaded: true,
                })
                expect(mockPostHog.persistence?.register).toHaveBeenCalledWith({ [SURVEYS]: delayedSurveys })
            })

            it('should set correct timeout value in request', () => {
                surveys.getSurveys(mockCallback)

                expect(mockPostHog._send_request).toHaveBeenCalledWith(
                    expect.objectContaining({
                        timeout: SURVEYS_REQUEST_TIMEOUT_MS,
                    })
                )
            })

            it('should force reload surveys when forceReload is true', () => {
                mockPostHog.get_property.mockReturnValue(mockSurveys)

                surveys.getSurveys(mockCallback, true)

                expect(mockPostHog._send_request).toHaveBeenCalled()
            })
        })
    })

    describe('doesSurveyUrlMatch', () => {
        const mockWindowLocation = (href: string | undefined) => {
            Object.defineProperty(window, 'location', {
                value: { href },
                writable: true,
            })
        }
        beforeEach(() => {
            // Reset window.location before each test
            mockWindowLocation(undefined)
        })

        it('should return true when no URL conditions are set', () => {
            const survey = { conditions: { events: null, actions: null } }
            expect(doesSurveyUrlMatch(survey)).toBe(true)

            const surveyWithNullConditions = { conditions: { url: null, events: null, actions: null } }
            expect(doesSurveyUrlMatch(surveyWithNullConditions)).toBe(true)
        })

        it('should return false when window.location.href is not available', () => {
            const survey = { conditions: { url: 'example.com', events: null, actions: null } }
            expect(doesSurveyUrlMatch(survey)).toBe(false)
        })

        describe('URL matching types', () => {
            beforeEach(() => {
                mockWindowLocation('https://example.com/path')
            })

            it('should match using icontains (default) match type', () => {
                const survey = { conditions: { url: 'example.com', events: null, actions: null } }
                expect(doesSurveyUrlMatch(survey)).toBe(true)

                const nonMatchingSurvey = { conditions: { url: 'nonexistent.com', events: null, actions: null } }
                expect(doesSurveyUrlMatch(nonMatchingSurvey)).toBe(false)
            })

            it('should match using explicit icontains match type', () => {
                const survey = {
                    conditions: {
                        url: 'example.com',
                        urlMatchType: 'icontains' as const,
                        events: null,
                        actions: null,
                    },
                }
                expect(doesSurveyUrlMatch(survey)).toBe(true)

                const caseInsensitiveSurvey = {
                    conditions: {
                        url: 'EXAMPLE.COM',
                        urlMatchType: 'icontains' as const,
                        events: null,
                        actions: null,
                    },
                }
                expect(doesSurveyUrlMatch(caseInsensitiveSurvey)).toBe(true)
            })

            it('should match using not_icontains match type', () => {
                const survey = {
                    conditions: {
                        url: 'nonexistent.com',
                        urlMatchType: 'not_icontains' as const,
                        events: null,
                        actions: null,
                    },
                }
                expect(doesSurveyUrlMatch(survey)).toBe(true)

                const nonMatchingSurvey = {
                    conditions: {
                        url: 'example.com',
                        urlMatchType: 'not_icontains' as const,
                        events: null,
                        actions: null,
                    },
                }
                expect(doesSurveyUrlMatch(nonMatchingSurvey)).toBe(false)
            })

            it('should match using regex match type', () => {
                const survey = {
                    conditions: {
                        url: '^https://.*\\.com/.*$',
                        urlMatchType: 'regex' as const,
                        events: null,
                        actions: null,
                    },
                }
                expect(doesSurveyUrlMatch(survey)).toBe(true)

                const nonMatchingSurvey = {
                    conditions: {
                        url: '^https://.*\\.org/.*$',
                        urlMatchType: 'regex' as const,
                        events: null,
                        actions: null,
                    },
                }
                expect(doesSurveyUrlMatch(nonMatchingSurvey)).toBe(false)
            })

            it('should match using not_regex match type', () => {
                const survey = {
                    conditions: {
                        url: '^https://.*\\.org/.*$',
                        urlMatchType: 'not_regex' as const,
                        events: null,
                        actions: null,
                    },
                }
                expect(doesSurveyUrlMatch(survey)).toBe(true)

                const nonMatchingSurvey = {
                    conditions: {
                        url: '^https://.*\\.com/.*$',
                        urlMatchType: 'not_regex' as const,
                        events: null,
                        actions: null,
                    },
                }
                expect(doesSurveyUrlMatch(nonMatchingSurvey)).toBe(false)
            })

            it('should match using exact match type', () => {
                mockWindowLocation('https://example.com')

                const survey = {
                    conditions: {
                        url: 'https://example.com',
                        urlMatchType: 'exact' as const,
                        events: null,
                        actions: null,
                    },
                }
                expect(doesSurveyUrlMatch(survey)).toBe(true)

                const nonMatchingSurvey = {
                    conditions: {
                        url: 'https://example.com/path',
                        urlMatchType: 'exact' as const,
                        events: null,
                        actions: null,
                    },
                }
                expect(doesSurveyUrlMatch(nonMatchingSurvey)).toBe(false)
            })

            it('should match using is_not match type', () => {
                mockWindowLocation('https://example.com')

                const survey = {
                    conditions: {
                        url: 'https://other.com',
                        urlMatchType: 'is_not' as const,
                        events: null,
                        actions: null,
                    },
                }
                expect(doesSurveyUrlMatch(survey)).toBe(true)

                const nonMatchingSurvey = {
                    conditions: {
                        url: 'https://example.com',
                        urlMatchType: 'is_not' as const,
                        events: null,
                        actions: null,
                    },
                }
                expect(doesSurveyUrlMatch(nonMatchingSurvey)).toBe(false)
            })
        })
    })
})
