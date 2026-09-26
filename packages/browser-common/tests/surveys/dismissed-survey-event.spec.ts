// @vitest-environment jsdom
import '../helpers/surveys-setup'
import type { Mock } from 'vitest'
import { createSurveyRenderContext } from '../helpers/survey-render-context'

import { dismissedSurveyEvent, setInProgressSurveyState } from '../../src/surveys/surveys-extension-utils'
import { SurveyQuestionType, SurveyType } from '../../src/survey-constants'
import type { Survey } from '../../src/types/surveys'

describe('dismissedSurveyEvent', () => {
    const survey: Survey = {
        id: 'survey-dismiss-lang',
        name: 'Dismiss Language Survey',
        type: SurveyType.Popover,
        questions: [{ type: SurveyQuestionType.Open, question: 'Hello?', id: 'q1', description: '' }],
        appearance: null,
        conditions: null,
        start_date: '2024-01-01T00:00:00Z',
        end_date: null,
        current_iteration: null,
        current_iteration_start_date: null,
    } as unknown as Survey

    afterEach(() => {
        localStorage.clear()
    })

    it('does not fall back to the current display language when the answer-time language was null', () => {
        // The user answered while no translation matched (surveyLanguage: null is a real,
        // meaningful value here, not "unset") — then the display language changed before they
        // dismissed. The dismissed event must still report null/no language, not the new one.
        setInProgressSurveyState(
            survey,
            {
                surveySubmissionId: 'sub-1',
                lastQuestionIndex: 0,
                responses: { $survey_response_q1: 'answer' },
                surveyLanguage: null,
            },
            localStorage
        )
        const host = createSurveyRenderContext({ capture: vi.fn(), canCapture: true })

        dismissedSurveyEvent(survey, host, false, 'fr')

        const [, properties] = (host.capture as Mock).mock.calls[0]
        expect(properties).not.toHaveProperty('$survey_language')
    })

    it('uses the answer-time language when one was recorded', () => {
        setInProgressSurveyState(
            survey,
            {
                surveySubmissionId: 'sub-1',
                lastQuestionIndex: 0,
                responses: { $survey_response_q1: 'answer' },
                surveyLanguage: 'es',
            },
            localStorage
        )
        const host = createSurveyRenderContext({ capture: vi.fn(), canCapture: true })

        dismissedSurveyEvent(survey, host, false, 'fr')

        const [, properties] = (host.capture as Mock).mock.calls[0]
        expect(properties).toEqual(expect.objectContaining({ $survey_language: 'es' }))
    })

    it('falls back to the current display language when the survey was dismissed without answering', () => {
        // No in-progress state at all — nothing was ever answered, so there's no answer-time
        // language to prefer.
        const host = createSurveyRenderContext({ capture: vi.fn(), canCapture: true })

        dismissedSurveyEvent(survey, host, false, 'fr')

        const [, properties] = (host.capture as Mock).mock.calls[0]
        expect(properties).toEqual(expect.objectContaining({ $survey_language: 'fr' }))
    })
})
