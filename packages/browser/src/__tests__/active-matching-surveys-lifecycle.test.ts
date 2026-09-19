import { isArray } from '@posthog/core'

import { BrowserSurveys } from '../browser-surveys'
import { SURVEYS } from '../constants'
import { SurveyManager } from '../extensions/surveys'
import { dismissedSurveyEvent, sendSurveyEvent } from '../extensions/surveys/surveys-extension-utils'
import type { PostHog } from '../posthog-core'
import { Survey, SurveyEventName, SurveyEventProperties, SurveyType } from '../posthog-surveys-types'
import type { CaptureResult } from '../types'
import { assignableWindow } from '../utils/globals'
import { setSurveySeenOnLocalStorage } from '../utils/survey-utils'
import { createMockConfig, createMockPersistence, createMockPostHog } from './helpers/posthog-instance'
import { createSurveysClient } from './helpers/surveys-client'

const untargetedSurvey: Survey = {
    id: 'untargeted-subscription-survey',
    name: 'Untargeted subscription survey',
    description: '',
    type: SurveyType.API,
    questions: [],
    linked_flag_key: null,
    targeting_flag_key: null,
    internal_targeting_flag_key: null,
    start_date: '2022-10-10T00:00:00.000Z',
    end_date: null,
    conditions: {},
} as Survey

describe('active matching survey subscription lifecycle consumption', () => {
    let surveys: BrowserSurveys
    let posthog: PostHog
    let state: Record<string, any>
    let captureHooks: Set<Parameters<PostHog['_addCaptureHook']>[0]>
    let originalExtensions: typeof assignableWindow.__PosthogExtensions__

    beforeEach(() => {
        localStorage.clear()
        originalExtensions = assignableWindow.__PosthogExtensions__
        state = { [SURVEYS]: [untargetedSurvey] }
        captureHooks = new Set()

        posthog = createMockPostHog({
            config: createMockConfig({ disable_surveys: false, capture_pageview: false }),
            persistence: createMockPersistence({
                props: state,
                register: vi.fn((properties) => {
                    Object.assign(state, properties)
                    return true
                }),
                unregister: vi.fn((key) => {
                    if (isArray(key)) {
                        key.forEach((item) => delete state[item])
                    } else {
                        delete state[key as string]
                    }
                }),
            }),
            get_property: vi.fn((key) => state[key]),
            register: vi.fn((properties) => Object.assign(state, properties)),
            unregister: vi.fn((key) => {
                delete state[key]
            }),
            get_session_id: vi.fn(() => 'session-1'),
            onSessionId: vi.fn(() => () => {}),
            onFeatureFlags: vi.fn(() => () => {}),
            _addCaptureHook: vi.fn((callback) => {
                captureHooks.add(callback)
                return () => {
                    captureHooks.delete(callback)
                }
            }),
            capture: vi.fn((eventName: string, properties: Record<string, any> = {}) => {
                // Mirror the real PostHog.capture ordering: lifecycle capture applies seen-state
                // before `_addCaptureHook` receives the `eventCaptured` notification.
                if (eventName === SurveyEventName.DISMISSED || eventName === SurveyEventName.SENT) {
                    const surveyId = properties[SurveyEventProperties.SURVEY_ID] as string | undefined
                    if (surveyId) {
                        setSurveySeenOnLocalStorage({
                            id: surveyId,
                            current_iteration: properties[SurveyEventProperties.SURVEY_ITERATION] as
                                | number
                                | null
                                | undefined,
                        })
                    }
                }
                const payload = { event: eventName, properties } as CaptureResult
                Array.from(captureHooks).forEach((hook) => hook(eventName, payload))
                return payload
            }) as PostHog['capture'],
            _send_request: vi.fn(),
            requestRouter: {
                endpointFor: () => 'https://test.com/api/surveys/',
            } as unknown as PostHog['requestRouter'],
            featureFlags: {
                hasLoadedFlags: true,
                isFeatureEnabled: vi.fn(),
                getFeatureFlag: vi.fn(),
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
        surveys['_isSurveysEnabled'] = true
        surveys.loadIfEnabled()
    })

    afterEach(() => {
        surveys.dispose()
        assignableWindow.__PosthogExtensions__ = originalExtensions
        localStorage.clear()
        vi.restoreAllMocks()
    })

    const expectConsumed = (callback: ReturnType<typeof vi.fn>): void => {
        expect(callback.mock.lastCall?.[0]).toEqual([])
        const getter = vi.fn()
        surveys.getActiveMatchingSurveys(getter)
        expect(getter.mock.lastCall?.[0]).toEqual([])
    }

    it('review regression: notifies after an untargeted survey is dismissed through the SDK helper', () => {
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        expect(callback.mock.lastCall?.[0]).toEqual([untargetedSurvey])

        dismissedSurveyEvent(untargetedSurvey, posthog)

        expectConsumed(callback)
    })

    it('review regression: notifies after an untargeted survey is submitted through the SDK helper', () => {
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        expect(callback.mock.lastCall?.[0]).toEqual([untargetedSurvey])

        sendSurveyEvent({
            responses: {},
            survey: untargetedSurvey,
            surveySubmissionId: 'submission-1',
            isSurveyCompleted: true,
            posthog,
        })

        expectConsumed(callback)
    })
})
