import { getSurveyRenderContext } from '../../browser-surveys'
import { surveyStorage } from '@posthog/browser-common/utils/survey-storage'
import {
    doesSurveyUrlMatch,
    getSurveySeen,
    hasWaitPeriodPassed,
    sendSurveyEvent,
} from '@posthog/browser-common/surveys/surveys-extension-utils'
import { PostHog } from '../../posthog-core'
import { Survey, SurveyType } from '@posthog/browser-common'
import { SURVEY_LOGGER } from '@posthog/browser-common/utils/survey-utils'

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

    describe('get_current_url override', () => {
        const posthogWith = (getCurrentUrl?: (defaultUrl: string) => string) =>
            getSurveyRenderContext({ config: { get_current_url: getCurrentUrl } } as PostHog)!

        it('matches against the overridden URL instead of window.location.href', () => {
            // raw browser URL would not match the survey condition
            mockWindowLocation('https://generated-host.skin/game')
            const survey = { conditions: { url: 'app.example.com', events: null, actions: null } }

            expect(
                doesSurveyUrlMatch(
                    survey,
                    posthogWith(() => 'https://app.example.com/settings')
                )
            ).toBe(true)
        })

        it('falls back to window.location.href when no override is configured', () => {
            mockWindowLocation('https://app.example.com/settings')
            const survey = { conditions: { url: 'app.example.com', events: null, actions: null } }

            expect(doesSurveyUrlMatch(survey, posthogWith())).toBe(true)
        })
    })
})
describe('sendSurveyEvent', () => {
    const baseSurvey: Survey = {
        id: 'test-survey-id',
        name: 'Test Survey',
        description: 'Test Description',
        type: SurveyType.Popover,
        questions: [{ type: 'open', question: 'What do you think?', id: 'q1' }],
        appearance: null,
        conditions: null,
        start_date: null,
        end_date: null,
        current_iteration: null,
        current_iteration_start_date: null,
        feature_flag_keys: null,
        linked_flag_key: null,
        targeting_flag_key: null,
        internal_targeting_flag_key: null,
    }

    beforeEach(() => {
        localStorage.clear()
    })

    it('reads the consent gate of a core without is_capturing', () => {
        const critical = vi.spyOn(SURVEY_LOGGER, 'critical').mockImplementation(() => {})
        const mockCapture = vi.fn()
        const mockPostHog = {
            capture: mockCapture,
            reloadFeatureFlags: vi.fn(),
            has_opted_out_capturing: () => true,
        } as unknown as PostHog

        expect(() =>
            sendSurveyEvent({
                responses: { $survey_response_q1: 'Great!' },
                survey: baseSurvey,
                surveySubmissionId: 'submission-123',
                isSurveyCompleted: true,
                posthog: getSurveyRenderContext(mockPostHog),
            })
        ).not.toThrow()

        expect(critical).not.toHaveBeenCalled()
        expect(mockCapture).not.toHaveBeenCalled()
        critical.mockRestore()
    })

    it('stays silent on a core without is_capturing while the person is opted in', () => {
        const critical = vi.spyOn(SURVEY_LOGGER, 'critical').mockImplementation(() => {})
        const mockPostHog = {
            capture: vi.fn(),
            reloadFeatureFlags: vi.fn(),
            has_opted_out_capturing: () => false,
        } as unknown as PostHog

        sendSurveyEvent({
            responses: { $survey_response_q1: 'Great!' },
            survey: baseSurvey,
            surveySubmissionId: 'submission-123',
            isSurveyCompleted: true,
            posthog: getSurveyRenderContext(mockPostHog),
        })

        expect(critical).not.toHaveBeenCalled()
        critical.mockRestore()
    })
})

describe('survey storage adapter', () => {
    it('should not throw when localStorage.getItem is unavailable', () => {
        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage unavailable')
        })

        expect(hasWaitPeriodPassed(7, surveyStorage)).toBe(true)

        getItemSpy.mockRestore()
    })
    it('should return false when localStorage access throws', () => {
        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage unavailable')
        })

        expect(getSurveySeen({ id: 'storage-unavailable' } as Survey, surveyStorage)).toBe(false)

        getItemSpy.mockRestore()
    })
})
