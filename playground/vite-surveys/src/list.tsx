import { Surveys } from '../../../src/extensions/surveys'
import {
    BasicSurveyQuestion,
    RatingSurveyQuestion,
    LinkSurveyQuestion,
    SurveyQuestionType,
    SurveyType,
    MultipleSurveyQuestion,
} from '../../../src/posthog-surveys-types'

const surveys = [
    {
        id: 'survey-1',
        name: 'some_name',
        type: SurveyType.Popover,
        description: 'Some description',
        questions: [
            {
                type: SurveyQuestionType.Open,
                question: 'What can we do to improve our product?',
            } as BasicSurveyQuestion,
        ],
        linked_flag_key: null,
        targeting_flag_key: null,
        appearance: {},
        conditions: null,
        start_date: null,
        end_date: null,
    },
    {
        id: 'survey-2',
        name: 'some_name',
        description: 'Some description',
        type: SurveyType.Popover,
        questions: [
            {
                type: SurveyQuestionType.Link,
                question: 'Would you be interested in participating in a customer interview?',
                description: 'We are looking for feedback on our product and would love to hear from you!',
                buttonText: 'Schedule',
            } as LinkSurveyQuestion,
        ],
        linked_flag_key: null,
        targeting_flag_key: null,
        appearance: {},
        conditions: null,
        start_date: null,
        end_date: null,
    },
    {
        id: 'survey-3',
        name: 'some_name',
        description: 'Some description',
        type: SurveyType.Popover,
        questions: [
            {
                type: SurveyQuestionType.Rating,
                question: 'How likely are you to recommend us to a friend?',
                description: '',
                display: 'number',
                scale: 10,
                lowerBoundLabel: 'Unlikely',
                upperBoundLabel: 'Very likely',
            } as RatingSurveyQuestion,
        ],
        linked_flag_key: null,
        targeting_flag_key: null,
        appearance: {},
        conditions: null,
        start_date: null,
        end_date: null,
    },
    {
        id: 'survey-4',
        name: 'some_name',
        description: 'Some description',
        type: SurveyType.Popover,
        questions: [
            {
                type: SurveyQuestionType.SingleChoice,
                question: 'How would you feel if you could no longer use PostHog?',
                choices: ['Not disappointed', 'Somewhat disappointed', 'Very disappointed'],
            } as MultipleSurveyQuestion,
        ],
        linked_flag_key: null,
        targeting_flag_key: null,
        appearance: {},
        conditions: null,
        start_date: null,
        end_date: null,
    },
    {
        id: 'survey-5',
        name: 'some_name',
        description: 'Some description',
        type: SurveyType.Popover,
        questions: [
            {
                type: SurveyQuestionType.Rating,
                question: 'How satisfied are you with PostHog surveys?',
                description: '',
                display: 'emoji',
                scale: 5,
                lowerBoundLabel: 'Very dissatisfied',
                upperBoundLabel: 'Very satisfied',
            } as RatingSurveyQuestion,
        ],
        linked_flag_key: null,
        targeting_flag_key: null,
        appearance: {},
        conditions: null,
        start_date: null,
        end_date: null,
    },
    {
        id: 'survey-6',
        name: 'some_name',
        description: 'Some description',
        type: SurveyType.Popover,
        questions: [
            {
                type: SurveyQuestionType.Rating,
                question: 'How easy was it to use our product?',
                description: '',
                display: 'emoji',
                scale: 5,
                lowerBoundLabel: 'Very difficult',
                upperBoundLabel: 'Very easy',
            } as RatingSurveyQuestion,
        ],
        linked_flag_key: null,
        targeting_flag_key: null,
        appearance: {},
        conditions: null,
        start_date: null,
        end_date: null,
    },
    {
        id: 'survey-7',
        name: 'some_name',
        description: 'Some description',
        type: SurveyType.Popover,
        questions: [
            {
                type: SurveyQuestionType.MultipleChoice,
                question: "We're sorry to see you go. What's your reason for unsubscribing?",
                choices: [
                    'I no longer need the product',
                    'I found a better product',
                    'I found the product too difficult to use',
                    'Other',
                ],
            } as MultipleSurveyQuestion,
        ],
        linked_flag_key: null,
        targeting_flag_key: null,
        appearance: {},
        conditions: null,
        start_date: null,
        end_date: null,
    },
]

export function List() {
    return (
        <div style={{ width: '100%', paddingLeft: '40px', paddingRight: '40px', display: 'flex', flexWrap: 'wrap' }}>
            {surveys.map((survey) => (
                <div style={{ width: '33%', paddingTop: '40px' }}>
                    <Surveys
                        readOnly={true}
                        style={{
                            position: 'relative',
                            right: 'initial',
                            left: 'initial',
                            top: 'initial',
                            bottom: 'initial',
                        }}
                        survey={survey}
                    />
                </div>
            ))}
        </div>
    )
}
