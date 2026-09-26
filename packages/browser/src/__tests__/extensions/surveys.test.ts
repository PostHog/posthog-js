import { getSurveyRenderContext } from '../../browser-surveys'
import { SurveyManager } from '@posthog/browser-common/surveys-renderer'
import { Survey, SurveyQuestionType, SurveyType } from '@posthog/browser-common'
import { beforeEach } from 'vitest'
import { PostHog } from '../../posthog-core'
import { PostHogFeatureFlags } from '@posthog/browser-common/feature-flags'
import { MutableFeatureFlagsConfigSource } from '../../feature-flags-config'
import { FeatureFlagsCommonExtension } from '@posthog/browser-common/extension-tokens'
import { FlagsResponse } from '../../types'
import { createMockPostHog } from '../helpers/posthog-instance'

describe('SurveyManager', () => {
    let mockPostHog: PostHog
    let surveyManager: SurveyManager
    let mockSurveys: Survey[]
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
        mockSurveys = [
            {
                id: 'testSurvey1',
                name: 'Test survey 1',
                description: 'Test survey description 1',
                type: SurveyType.Popover,
                linked_flag_key: null,
                targeting_flag_key: null,
                internal_targeting_flag_key: null,
                questions: [
                    {
                        question: 'How satisfied are you with our newest product?',
                        description: 'This is a question description',
                        descriptionContentType: 'text',
                        type: SurveyQuestionType.Rating,
                        display: 'number',
                        scale: 10,
                        lowerBoundLabel: 'Not Satisfied',
                        upperBoundLabel: 'Very Satisfied',
                        id: 'question-a',
                    },
                ],
                appearance: {},
                conditions: null,
                start_date: '2021-01-01T00:00:00.000Z',
                end_date: null,
                current_iteration: null,
                current_iteration_start_date: null,
                feature_flag_keys: [],
            },
        ]

        mockPostHog = createMockPostHog({
            getActiveMatchingSurveys: vi.fn(),
            get_session_replay_url: vi.fn(),
            is_capturing: vi.fn(() => true),
            capture: vi.fn(),
            featureFlags: {
                onFeatureFlags: vi.fn(() => () => {}),
                hasLoadedFlags: true,
                _send_request: vi
                    .fn()
                    .mockImplementation(({ callback }) => callback({ statusCode: 200, json: flagsResponse })),
                getFeatureFlag: vi.fn().mockImplementation((featureFlag) => flagsResponse.featureFlags[featureFlag]),
                isFeatureEnabled: vi.fn().mockImplementation((featureFlag) => flagsResponse.featureFlags[featureFlag]),
            },
            surveys: {
                getSurveys: vi.fn().mockImplementation((callback) => callback(mockSurveys)),
            },
        })

        surveyManager = new SurveyManager(getSurveyRenderContext(mockPostHog)!)
    })

    it('resolves feature flags through the extension registry', () => {
        const registeredFeatureFlags = new PostHogFeatureFlags(new MutableFeatureFlagsConfigSource(mockPostHog.config))
        vi.spyOn(registeredFeatureFlags, 'getFeatureFlag').mockReturnValue('control')
        vi.spyOn(registeredFeatureFlags, 'isFeatureEnabled').mockReturnValue(true)
        const client = getSurveyRenderContext(mockPostHog)!.client!
        client.getExtension = vi.fn(() => registeredFeatureFlags) as typeof client.getExtension
        const survey = {
            ...mockSurveys[0],
            linked_flag_key: 'linked-flag-key',
            conditions: { linkedFlagVariant: 'control' },
        }

        expect(surveyManager.checkSurveyEligibility(survey).eligible).toBe(true)
        expect(getSurveyRenderContext(mockPostHog)!.client!.getExtension).toHaveBeenCalledWith(
            FeatureFlagsCommonExtension
        )
        expect(registeredFeatureFlags.isFeatureEnabled).toHaveBeenCalledWith('linked-flag-key', { send_event: true })
        expect(registeredFeatureFlags.getFeatureFlag).toHaveBeenCalledWith('linked-flag-key', { send_event: false })
        expect(mockPostHog.featureFlags.isFeatureEnabled).not.toHaveBeenCalled()
    })

    it('falls back to the legacy featureFlags property when extension lookup is unavailable', () => {
        const survey = { ...mockSurveys[0], linked_flag_key: 'linked-flag-key' }

        expect(surveyManager.checkSurveyEligibility(survey).eligible).toBe(true)
        expect(mockPostHog.featureFlags.isFeatureEnabled).toHaveBeenCalledWith('linked-flag-key', {
            send_event: true,
        })
    })

    describe('on a core without is_capturing (version skew)', () => {
        beforeEach(() => {
            // @ts-expect-error deliberately removing the method to emulate an older core
            mockPostHog.is_capturing = undefined
        })

        it('is not eligible to display when that core says the person opted out', () => {
            mockPostHog.has_opted_out_capturing = vi.fn(() => true)
            const result = surveyManager.checkSurveyDisplayEligibility(mockSurveys[0])
            expect(result.eligible).toBe(false)
            expect(result.reason).toBe('PostHog is not capturing, so a survey response cannot be recorded')
        })

        it('still displays the survey when that core says the person opted in', () => {
            mockPostHog.has_opted_out_capturing = vi.fn(() => false)
            const handlePopoverSurveyMock = vi
                .spyOn(surveyManager as any, 'handlePopoverSurvey')
                .mockImplementation(() => {})

            expect(() => surveyManager.callSurveysAndEvaluateDisplayLogic()).not.toThrow()

            expect(surveyManager.checkSurveyDisplayEligibility(mockSurveys[0]).eligible).toBe(true)
            expect(handlePopoverSurveyMock).toHaveBeenCalled()
        })
    })

    afterEach(() => {
        surveyManager.dispose()
    })
})
