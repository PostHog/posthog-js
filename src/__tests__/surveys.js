import { PostHogSurveys } from '../posthog-surveys'
import { PostHogPersistence } from '../posthog-persistence'
import { SurveyQuestionType, SurveyType } from '../types'

describe('surveys', () => {
    given('config', () => ({
        token: 'testtoken',
        api_host: 'https://app.posthog.com',
        persistence: 'memory',
    })),

        given('instance', () => ({
            get_config: jest.fn().mockImplementation((key) => given.config[key]),
            _prepare_callback: (callback) => callback,
            persistence: new PostHogPersistence(given.config),
            register: (props) => given.instance.persistence.register(props),
            unregister: (key) => given.instance.persistence.unregister(key),
            get_property: (key) => given.instance.persistence.props[key],
            _send_request: jest
                .fn()
                .mockImplementation((url, data, headers, callback) => callback(given.surveysResponse)),
        }))

    given('surveys', () => new PostHogSurveys(given.instance))

    afterEach(() => {
        given.instance.persistence.clear()
    })

    const firstSurveys =
        [
            { name: 'first survey', description: 'first survey description', type: SurveyType.Popover, questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }] },
        ]

    const secondSurveys = [
        { name: 'first survey', description: 'first survey description', type: SurveyType.Popover, questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }] },
        { name: 'second survey', description: 'second survey description', type: SurveyType.Popover, questions: [{ type: SurveyQuestionType.Open, question: 'what is a moblin?' }] },
    ]
    // possibly compute whether the survey is active or not for the user since we already have feature flags available here.. with linked/targeting flags

    given('surveysResponse', () => ({ surveys: firstSurveysResponse }))

    it('getSurveys gets a list of surveys if not present already', () => {
        given.surveys.getSurveys((data) => {
            expect(data).toEqual(firstSurveys)
        })
        expect(given.instance._send_request).toHaveBeenCalledWith(
            'https://app.posthog.com/api/surveys/?token=testtoken',
            {},
            { method: 'GET' },
            expect.any(Function)
        )
        expect(given.instance._send_request).toHaveBeenCalledTimes(1)
        expect(given.instance.persistence.props.$surveys).toEqual(firstSurveys)

        given('surveysResponse', () => ({ surveys: secondSurveys }))
        given.surveys.getSurveys((data) => {
            expect(data).toEqual(firstSurveys)
        })
        // request again, shouldn't call _send_request again, so 1 total call instead of 2
        expect(given.instance._send_request).toHaveBeenCalledTimes(1)
    })

    it('getSurveys force reloads when called with true', () => {
        given.surveys.getSurveys((data) => {
            expect(data).toEqual(firstSurveys)
        })
        expect(given.instance._send_request).toHaveBeenCalledWith(
            'https://app.posthog.com/api/surveys/?token=testtoken',
            {},
            { method: 'GET' },
            expect.any(Function)
        )
        expect(given.instance._send_request).toHaveBeenCalledTimes(1)
        expect(given.instance.persistence.props.$surveys).toEqual(firstSurveys)

        given('surveysResponse', () => ({ surveys: secondSurveys }))

        given.surveys.getSurveys((data) => {
            expect(data).toEqual(secondSurveysResponse)
        }, true)
        expect(given.instance._send_request).toHaveBeenCalledTimes(2)
    })
})