/// <reference lib="dom" />
import { expect, it, describe, beforeEach, afterEach, vi } from 'vitest'
import { SURVEYS_REQUEST_TIMEOUT_MS } from '../constants'
import { PostHog } from '../posthog-core'
import { PostHogPersistence } from '../posthog-persistence'
import { BrowserSurveys } from '../browser-surveys'
import { Survey, SurveyQuestionType, SurveyType } from '@posthog/browser-common'
import { PostHogConfig } from '../types'
import { RequestRouter } from '../utils/request-router'
import { createMockPostHog, createMockConfig } from './helpers/posthog-instance'
import { createSurveysClient } from './helpers/surveys-client'

describe('survey transport and persistence', () => {
    let config: PostHogConfig
    let instance: PostHog
    let surveys: BrowserSurveys
    let surveysResponse: { status?: number; surveys?: Survey[] }
    const getSurveys = (forceReload = false): Promise<Survey[]> =>
        new Promise((resolve) => surveys.getSurveys(resolve, forceReload))

    const firstSurveys: Survey[] = [
        {
            id: 'first-survey',
            name: 'first survey',
            description: 'first survey description',
            type: SurveyType.Popover,
            start_date: new Date().toISOString(),
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }],
        } as unknown as Survey,
    ]

    const secondSurveys: Survey[] = [
        {
            name: 'first survey',
            description: 'first survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a bokoblin?' }],
        } as unknown as Survey,
        {
            name: 'second survey',
            description: 'second survey description',
            type: SurveyType.Popover,
            questions: [{ type: SurveyQuestionType.Open, question: 'what is a moblin?' }],
        } as unknown as Survey,
    ]

    beforeEach(() => {
        surveysResponse = { surveys: firstSurveys }
        config = createMockConfig({
            token: 'testtoken',
            api_host: 'https://app.posthog.com',
            persistence: 'memory',
            surveys_request_timeout_ms: SURVEYS_REQUEST_TIMEOUT_MS,
        })
        instance = createMockPostHog({
            config,
            persistence: new PostHogPersistence(config),
            requestRouter: new RequestRouter({ config } as any),
            get_property: (key: string) => instance.persistence?.props[key],
            _send_request: vi.fn(({ callback }) => callback({ statusCode: 200, json: surveysResponse })),
        })
        surveys = new BrowserSurveys(instance)
        surveys.setup(createSurveysClient(instance))
    })

    afterEach(() => {
        surveys.dispose()
        instance.persistence?.clear()
    })

    it('getSurveys gets a list of surveys if not present already', async () => {
        expect(await getSurveys()).toEqual(firstSurveys)
        expect(instance._send_request).toHaveBeenCalledWith({
            url: 'https://us.i.posthog.com/api/surveys/?token=testtoken',
            timeout: SURVEYS_REQUEST_TIMEOUT_MS,
            method: 'GET',
            timestampMode: 'query',
            fireCallbackOnDrop: true,
            callback: expect.any(Function),
        })
        expect(instance._send_request).toHaveBeenCalledTimes(1)
        expect(instance.persistence?.props.$surveys).toEqual(firstSurveys)

        surveysResponse = { surveys: secondSurveys }
        surveys.getSurveys((data) => {
            expect(data).toEqual(firstSurveys)
        })
        // request again, shouldn't call _send_request again, so 1 total call instead of 2
        expect(instance._send_request).toHaveBeenCalledTimes(1)
    })

    it('getSurveys force reloads when called with true', async () => {
        expect(await getSurveys()).toEqual(firstSurveys)
        expect(instance._send_request).toHaveBeenCalledWith({
            url: 'https://us.i.posthog.com/api/surveys/?token=testtoken',
            timeout: SURVEYS_REQUEST_TIMEOUT_MS,
            method: 'GET',
            timestampMode: 'query',
            fireCallbackOnDrop: true,
            callback: expect.any(Function),
        })
        expect(instance._send_request).toHaveBeenCalledTimes(1)
        expect(instance.persistence?.props.$surveys).toEqual(firstSurveys)

        surveysResponse = { surveys: secondSurveys }

        expect(await getSurveys(true)).toEqual(secondSurveys)
        expect(instance.persistence?.props.$surveys).toEqual(secondSurveys)
        expect(instance._send_request).toHaveBeenCalledTimes(2)
    })
})
