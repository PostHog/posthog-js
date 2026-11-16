// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Survey } from '../src/types/surveys'
import { SurveyType } from '../src/survey-constants'
import { getSurveyReplayUrl } from '../src/survey-render-context'
import {
    clearAllInMemoryInProgressSurveyState,
    getInProgressSurveyState,
    sendSurveyAbandonedEvent,
    setInProgressSurveyState,
} from '../src/surveys/surveys-extension-utils'
import { SurveyManager } from '../src/surveys-renderer'
import { getSurveyAbandonedKey } from '../src/utils/survey-utils'
import { SURVEYS } from '../src/surveys-config'
import { TestClient } from './helpers/test-client'

const config = { disableSurveys: false, cookielessMode: false, advancedEnableSurveys: false, requestTimeoutMs: 10000 }

afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    clearAllInMemoryInProgressSurveyState()
})

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
        setInProgressSurveyState(survey, {
            surveySubmissionId: 'submission',
            lastQuestionIndex: 0,
            responses: { $survey_response_q1: 'partial answer' },
        })
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

    it('skips repeated unload capture when localStorage is blocked, retaining partial answers in memory', () => {
        const client = new TestClient()
        const survey = { id: 'blocked-storage', name: 'Feedback', questions: [] } as unknown as Survey
        client.kv.set(SURVEYS, [survey])
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        const state = { surveySubmissionId: 'submission', lastQuestionIndex: 0, responses: { answer: 'partial' } }
        setInProgressSurveyState(survey, state)
        expect(getInProgressSurveyState(survey)).toEqual(state)
        const manager = new SurveyManager({ client, config })
        try {
            manager.handlePageUnload()
            manager.handlePageUnload()
            expect(client.capturedEvents).toHaveLength(0)
            expect(getInProgressSurveyState(survey)).toEqual(state)
        } finally {
            manager.dispose()
        }
    })

    it('leaves the abandonment marker unwritten under denial, then captures once after consent', () => {
        const client = new TestClient({ canCapture: false })
        const survey = { id: 'consent', name: 'Feedback', questions: [] } as unknown as Survey
        client.kv.set(SURVEYS, [survey])
        setInProgressSurveyState(survey, {
            surveySubmissionId: 'submission',
            lastQuestionIndex: 0,
            responses: { answer: 'partial' },
        })
        const write = vi.spyOn(Storage.prototype, 'setItem')
        const manager = new SurveyManager({ client, config })
        try {
            manager.handlePageUnload()
            expect(write).not.toHaveBeenCalled()
            expect(localStorage.getItem(getSurveyAbandonedKey(survey))).toBeNull()
            expect(client.capturedEvents).toHaveLength(0)
            client.canCapture = true
            manager.handlePageUnload()
            manager.handlePageUnload()
            expect(client.capturedEvents).toHaveLength(1)
            expect(localStorage.getItem(getSurveyAbandonedKey(survey))).toBe('true')
        } finally {
            manager.dispose()
        }
    })
})
