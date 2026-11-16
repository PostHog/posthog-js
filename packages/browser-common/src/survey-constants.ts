export const SurveyEventType = {
    Activation: 'events',
    Cancellation: 'cancelEvents',
} as const

export const SurveyWidgetType = {
    Button: 'button',
    Tab: 'tab',
    Selector: 'selector',
} as const

export const SurveyPosition = {
    TopLeft: 'top_left',
    TopRight: 'top_right',
    TopCenter: 'top_center',
    MiddleLeft: 'middle_left',
    MiddleRight: 'middle_right',
    MiddleCenter: 'middle_center',
    Left: 'left',
    Center: 'center',
    Right: 'right',
    NextToTrigger: 'next_to_trigger',
} as const

export const SurveyTabPosition = {
    Top: 'top',
    Left: 'left',
    Right: 'right',
    Bottom: 'bottom',
} as const

export const SurveyType = {
    Popover: 'popover',
    API: 'api',
    Widget: 'widget',
    ExternalSurvey: 'external_survey',
} as const

export const SurveyQuestionType = {
    Open: 'open',
    MultipleChoice: 'multiple_choice',
    SingleChoice: 'single_choice',
    Rating: 'rating',
    Link: 'link',
} as const

export const SurveyQuestionBranchingType = {
    NextQuestion: 'next_question',
    End: 'end',
    ResponseBased: 'response_based',
    SpecificQuestion: 'specific_question',
} as const

export const SurveySchedule = {
    Once: 'once',
    Recurring: 'recurring',
    Always: 'always',
} as const

export const SurveyEventName = {
    SHOWN: 'survey shown',
    DISMISSED: 'survey dismissed',
    SENT: 'survey sent',
    ABANDONED: 'survey abandoned',
} as const

export const SurveyEventProperties = {
    SURVEY_ID: '$survey_id',
    SURVEY_NAME: '$survey_name',
    SURVEY_RESPONSE: '$survey_response',
    SURVEY_ITERATION: '$survey_iteration',
    SURVEY_ITERATION_START_DATE: '$survey_iteration_start_date',
    SURVEY_PARTIALLY_COMPLETED: '$survey_partially_completed',
    SURVEY_SUBMISSION_ID: '$survey_submission_id',
    SURVEY_QUESTIONS: '$survey_questions',
    SURVEY_COMPLETED: '$survey_completed',
    PRODUCT_TOUR_ID: '$product_tour_id',
    SURVEY_LAST_SEEN_DATE: '$survey_last_seen_date',
    SURVEY_LANGUAGE: '$survey_language',
} as const

export const DisplaySurveyType = {
    Popover: 'popover',
    Inline: 'inline',
} as const

export type SurveyEventType = (typeof SurveyEventType)[keyof typeof SurveyEventType]
export type SurveyWidgetType = (typeof SurveyWidgetType)[keyof typeof SurveyWidgetType]
export type SurveyPosition = (typeof SurveyPosition)[keyof typeof SurveyPosition]
export type SurveyTabPosition = (typeof SurveyTabPosition)[keyof typeof SurveyTabPosition]
export type SurveyType = (typeof SurveyType)[keyof typeof SurveyType]
export type SurveyQuestionType = (typeof SurveyQuestionType)[keyof typeof SurveyQuestionType]
export type SurveyQuestionBranchingType = (typeof SurveyQuestionBranchingType)[keyof typeof SurveyQuestionBranchingType]
export type SurveySchedule = (typeof SurveySchedule)[keyof typeof SurveySchedule]
export type SurveyEventName = (typeof SurveyEventName)[keyof typeof SurveyEventName]
export type SurveyEventProperties = (typeof SurveyEventProperties)[keyof typeof SurveyEventProperties]
export type DisplaySurveyType = (typeof DisplaySurveyType)[keyof typeof DisplaySurveyType]
