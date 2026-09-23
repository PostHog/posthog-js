// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Survey } from '../src/types/surveys'
import { SurveyType } from '../src/survey-constants'
import { getSurveyReplayUrl } from '../src/survey-render-context'
import { sendSurveyAbandonedEvent, setInProgressSurveyState } from '../src/surveys/surveys-extension-utils'
import { surveyStorage } from '../src/utils/survey-storage'
import { TestClient } from './helpers/test-client'

const config = { disableSurveys: false, cookielessMode: false, advancedEnableSurveys: false, requestTimeoutMs: 10000 }

afterEach(() => localStorage.clear())

describe('shared survey rendering capabilities', () => {
    it('constructs the replay URL from routed config and live client context', () => {
        const client = new TestClient({ projectToken: 'ph_test' })
        const context = { client, config: { ...config, uiHost: 'https://app.example.com' } }
        expect(getSurveyReplayUrl(context)).toBe('https://app.example.com/project/ph_test/replay/test-session-id')
        client.session = { ...client.session, sessionId: 'next-session' }
        expect(getSurveyReplayUrl(context)).toBe('https://app.example.com/project/ph_test/replay/next-session')
        expect(getSurveyReplayUrl({ config })).toBeUndefined()
    })

    it('omits the replay URL when there is no session', () => {
        const client = new TestClient({ projectToken: 'ph_test' })
        Object.defineProperty(client, 'session', { value: undefined })
        expect(getSurveyReplayUrl({ client, config: { ...config, uiHost: 'https://app.example.com' } })).toBeUndefined()
    })

    it('sends abandonment using shared unload delivery and standalone localStorage', () => {
        const client = new TestClient()
        const write = vi.spyOn(client.kv, 'set')
        const survey = {
            id: 'in-progress',
            name: 'In progress',
            type: SurveyType.Popover,
            questions: [{ id: 'q1', type: 'open', question: 'Feedback?' }],
        } as Survey
        setInProgressSurveyState(
            survey,
            {
                surveySubmissionId: 'submission',
                responses: { $survey_response_q1: 'partial answer' },
            },
            surveyStorage
        )
        sendSurveyAbandonedEvent(survey, { client, config })
        sendSurveyAbandonedEvent(survey, { client, config })
        expect(client.capturedEvents).toHaveLength(1)
        expect(client.capturedEvents[0]).toMatchObject({
            event: 'survey abandoned',
            options: { delivery: 'unload' },
            properties: {
                $survey_id: 'in-progress',
                $survey_submission_id: 'submission',
                $survey_response_q1: 'partial answer',
            },
        })
        expect(write).not.toHaveBeenCalled()
        expect(localStorage.length).toBeGreaterThan(0)
    })
})
