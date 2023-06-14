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
            featureFlags: {
                _send_request: jest
                    .fn()
                    .mockImplementation((url, data, headers, callback) => callback(given.decideResponse)),
                isFeatureEnabled: jest
                    .fn()
                    .mockImplementation((featureFlag) => given.decideResponse.featureFlags[featureFlag]),
            },
        }))

    given('surveys', () => new PostHogSurveys(given.instance))

    afterEach(() => {
        given.instance.persistence.clear()
    })

    const firstSurveys = [
        {
            name: 'first survey',
            description: 'first survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }],
        },
    ]

    const secondSurveys = [
        {
            name: 'first survey',
            description: 'first survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }],
        },
        {
            name: 'second survey',
            description: 'second survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a moblin?' }],
        },
    ]

    given('surveysResponse', () => ({ surveys: firstSurveys }))

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
            expect(data).toEqual(secondSurveys)
        }, true)
        expect(given.instance.persistence.props.$surveys).toEqual(secondSurveys)
        expect(given.instance._send_request).toHaveBeenCalledTimes(2)
    })

    describe('getActiveMatchingSurveys', () => {
        const draftSurvey = {
            name: 'draft survey',
            description: 'draft survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a draft survey?' }],
            start_date: null,
        }
        const activeSurvey = {
            name: 'active survey',
            description: 'active survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a active survey?' }],
            start_date: new Date().toISOString(),
            end_date: null,
        }
        const completedSurvey = {
            name: 'completed survey',
            description: 'completed survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a completed survey?' }],
            start_date: new Date('09/10/2022').toISOString(),
            end_date: new Date('10/10/2022').toISOString(),
        }
        const surveyWithUrl = {
            name: 'survey with url',
            description: 'survey with url description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with url?' }],
            conditions: { url: 'posthog.com' },
            start_date: new Date().toISOString(),
            end_date: null,
        }
        const surveyWithSelector = {
            name: 'survey with selector',
            description: 'survey with selector description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with selector?' }],
            conditions: { selector: '.test-selector' },
            start_date: new Date().toISOString(),
            end_date: null,
        }
        const surveyWithUrlAndSelector = {
            name: 'survey with url and selector',
            description: 'survey with url and selector description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with url and selector?' }],
            conditions: { url: 'posthogapp.com', selector: '#foo' },
            start_date: new Date().toISOString(),
            end_date: null,
        }
        const surveyWithFlags = {
            name: 'survey with flags',
            description: 'survey with flags description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with flags?' }],
            linked_flag_key: 'linked-flag-key',
            targeting_flag_key: 'survey-targeting-flag-key',
            start_date: new Date().toISOString(),
            end_date: null,
        }
        const surveyWithUnmatchedFlags = {
            name: 'survey with flags2',
            description: 'survey with flags description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with flags?' }],
            linked_flag_key: 'linked-flag-key2',
            targeting_flag_key: 'survey-targeting-flag-key2',
            start_date: new Date().toISOString(),
            end_date: null,
        }
        const surveyWithEverything = {
            name: 'survey with everything',
            description: 'survey with everything description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a survey with everything?' }],
            start_date: new Date().toISOString(),
            end_date: null,
            conditions: { url: 'posthogapp.com', selector: '.test-selector' },
            linked_flag_key: 'linked-flag-key',
            targeting_flag_key: 'survey-targeting-flag-key',
            start_date: new Date().toISOString(),
            end_date: null,
        }

        it('returns surveys that are active', () => {
            given('surveysResponse', () => ({ surveys: [draftSurvey, activeSurvey, completedSurvey] }))

            given.surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([activeSurvey])
            })
        })

        it('returns surveys based on url and selector matching', () => {
            given('surveysResponse', () => ({ surveys: [surveyWithUrl, surveyWithSelector, surveyWithUrlAndSelector] }))
            const originalWindowLocation = window.location
            delete window.location
            // eslint-disable-next-line compat/compat
            window.location = new URL('https://posthog.com')
            given.surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithUrl])
            })
            window.location = originalWindowLocation
            document.body.appendChild(document.createElement('div')).className = 'test-selector'
            given.surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithSelector])
            })
            document.body.removeChild(document.querySelector('.test-selector'))

            // eslint-disable-next-line compat/compat
            window.location = new URL('https://posthogapp.com')
            document.body.appendChild(document.createElement('div')).id = 'foo'

            given.surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithUrlAndSelector])
            })
            window.location = originalWindowLocation
            document.body.removeChild(document.querySelector('#foo'))
        })

        given('decideResponse', () => ({
            featureFlags: {
                'linked-flag-key': true,
                'survey-targeting-flag-key': true,
                'linked-flag-key2': true,
                'survey-targeting-flag-key2': false,
            },
        }))
        it('returns surveys that match linked and targeting feature flags', () => {
            given('surveysResponse', () => ({ surveys: [activeSurvey, surveyWithFlags, surveyWithEverything] }))
            given.surveys.getActiveMatchingSurveys((data) => {
                // active survey is returned because it has no flags aka there are no restrictions on flag enabled for it
                expect(data).toEqual([activeSurvey, surveyWithFlags])
            })
        })

        it('does not return surveys that have flag keys but no matching flags', () => {
            given('surveysResponse', () => ({ surveys: [surveyWithFlags, surveyWithUnmatchedFlags] }))
            given.surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([surveyWithFlags])
            })
        })

        it('returns surveys that inclusively matches any of the above', () => {
            window.location.delete
            // eslint-disable-next-line compat/compat
            window.location = new URL('https://posthogapp.com')
            document.body.appendChild(document.createElement('div')).className = 'test-selector'
            given('surveysResponse', () => ({ surveys: [activeSurvey, surveyWithSelector, surveyWithEverything] }))
            // activeSurvey returns because there are no restrictions on conditions or flags on it
            given.surveys.getActiveMatchingSurveys((data) => {
                expect(data).toEqual([activeSurvey, surveyWithSelector, surveyWithEverything])
            })
        })
    })
})
