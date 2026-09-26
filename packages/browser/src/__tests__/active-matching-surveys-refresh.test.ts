import type { ApiResponse } from '@posthog/browser-common'

import { BrowserSurveys } from '../browser-surveys'
import { SURVEYS } from '../constants'
import { SurveyManager } from '../extensions/surveys'
import type { PostHog } from '../posthog-core'
import { Survey, SurveyEventName, SurveyType } from '../posthog-surveys-types'
import type { CaptureResult } from '../types'
import { assignableWindow } from '../utils/globals'
import { createMockConfig, createMockPersistence, createMockPostHog } from './helpers/posthog-instance'
import { createSurveysClient } from './helpers/surveys-client'

const originalActionSurvey = {
    id: 'refresh-action-survey',
    name: 'Refresh action survey',
    description: '',
    type: SurveyType.API,
    questions: [],
    linked_flag_key: null,
    targeting_flag_key: null,
    internal_targeting_flag_key: null,
    start_date: '2022-10-10T00:00:00.000Z',
    end_date: null,
    conditions: {
        actions: {
            values: [{ id: 1, name: 'upgrade', steps: [{ event: 'account_upgraded' }] }],
        },
    },
} as Survey

const refreshedActionSurvey = {
    ...originalActionSurvey,
    conditions: {
        actions: {
            values: [{ id: 2, name: 'purchase', steps: [{ event: 'purchase_completed' }] }],
        },
    },
} as Survey

const flushRequests = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
        await Promise.resolve()
    }
}

describe('active matching survey definition refreshes', () => {
    let surveys: BrowserSurveys
    let posthog: PostHog
    let state: Record<string, any>
    let requests: Array<(response: ApiResponse) => void>
    let captureHooks: Set<Parameters<PostHog['_addCaptureHook']>[0]>
    let originalExtensions: typeof assignableWindow.__PosthogExtensions__

    beforeEach(() => {
        localStorage.clear()
        originalExtensions = assignableWindow.__PosthogExtensions__
        state = { [SURVEYS]: [originalActionSurvey] }
        requests = []
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
                    delete state[key as string]
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
            _send_request: vi.fn(({ callback }) => {
                requests.push(callback!)
            }),
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

    const capture = (event: string, properties: Record<string, unknown> = {}): void => {
        const payload = { event, properties } as CaptureResult
        Array.from(captureHooks).forEach((hook) => hook(event, payload))
    }

    const refreshDefinitions = async (definitions: Survey[]): Promise<void> => {
        surveys.getSurveys(() => {}, true)
        expect(requests).toHaveLength(1)
        requests.shift()!({ statusCode: 200, json: { surveys: definitions } })
        await flushRequests()
    }

    it('replaces stale action triggers when refreshed definitions change or remove them', async () => {
        const callback = vi.fn()
        surveys.onActiveMatchingSurveysChanged(callback)
        expect(callback.mock.lastCall?.[0]).toEqual([])

        capture('account_upgraded')
        expect(callback.mock.lastCall?.[0]).toEqual([originalActionSurvey])

        capture(SurveyEventName.DISMISSED, { $survey_id: originalActionSurvey.id })
        expect(callback.mock.lastCall?.[0]).toEqual([])

        await refreshDefinitions([refreshedActionSurvey])
        callback.mockClear()

        capture('account_upgraded')
        expect(callback).not.toHaveBeenCalled()

        capture('purchase_completed')
        expect(callback.mock.lastCall?.[0]).toEqual([refreshedActionSurvey])

        capture(SurveyEventName.DISMISSED, { $survey_id: refreshedActionSurvey.id })
        expect(callback.mock.lastCall?.[0]).toEqual([])

        await refreshDefinitions([])
        callback.mockClear()

        capture('purchase_completed')
        expect(callback).not.toHaveBeenCalled()
    })
})
