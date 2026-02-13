import * as React from 'react'
import { renderHook, act } from '@testing-library/react'
import { PostHogProvider, PostHog } from '../../context'
import { useThumbSurvey } from '../../extensions/surveys/hooks/useThumbSurvey'
import { SurveyEventName, SurveyEventProperties } from 'posthog-js'
import { isUndefined } from '../../utils/type-utils'

jest.useFakeTimers()

describe('useThumbSurvey hook', () => {
    let posthog: PostHog
    let captureMock: jest.Mock
    let displaySurveyMock: jest.Mock
    let wrapper: React.FC<{ children: React.ReactNode }>

    beforeEach(() => {
        captureMock = jest.fn()
        displaySurveyMock = jest.fn()

        posthog = {
            capture: captureMock,
            get_session_replay_url: () => 'https://app.posthog.com/replay/123',
            surveys: { displaySurvey: displaySurveyMock },
        } as unknown as PostHog

        wrapper = ({ children }) => <PostHogProvider client={posthog}>{children}</PostHogProvider>
    })

    describe('survey shown tracking', () => {
        it.each([
            [false, true, false], // disableAutoShownTracking, shouldAutoTrack, shouldExposeTrackShown
            [true, false, true],
        ])(
            'disableAutoShownTracking=%s: auto-tracks=%s, exposes trackShown=%s',
            (disableAutoShownTracking, shouldAutoTrack, shouldExposeTrackShown) => {
                const { result } = renderHook(
                    () => useThumbSurvey({ surveyId: 'test-survey', disableAutoShownTracking }),
                    { wrapper }
                )

                expect(captureMock).toHaveBeenCalledTimes(shouldAutoTrack ? 1 : 0)
                expect(!isUndefined(result.current.trackShown)).toBe(shouldExposeTrackShown)
            }
        )

        it('should only emit survey shown once when trackShown is called multiple times', () => {
            const { result } = renderHook(
                () => useThumbSurvey({ surveyId: 'test-survey', disableAutoShownTracking: true }),
                { wrapper }
            )

            act(() => {
                result.current.trackShown?.()
                result.current.trackShown?.()
            })

            expect(captureMock).toHaveBeenCalledTimes(1)
            expect(captureMock).toHaveBeenCalledWith(SurveyEventName.SHOWN, {
                [SurveyEventProperties.SURVEY_ID]: 'test-survey',
                sessionRecordingUrl: 'https://app.posthog.com/replay/123',
            })
        })
    })

    describe('respond', () => {
        it.each([
            ['up', 1],
            ['down', 2],
        ] as const)('respond("%s") calls displaySurvey with initialResponses: { 0: %d }', (value, expectedResponse) => {
            const { result } = renderHook(() => useThumbSurvey({ surveyId: 'test-survey' }), { wrapper })

            act(() => {
                result.current.respond(value)
            })

            expect(displaySurveyMock).toHaveBeenCalledWith(
                'test-survey',
                expect.objectContaining({ initialResponses: { 0: expectedResponse } })
            )
        })

        it('should only allow one response', () => {
            const { result } = renderHook(() => useThumbSurvey({ surveyId: 'test-survey' }), { wrapper })

            act(() => {
                result.current.respond('up')
                result.current.respond('down')
            })

            expect(displaySurveyMock).toHaveBeenCalledTimes(1)
            expect(result.current.response).toBe('up')
        })

        it('should call onResponse callback', () => {
            const onResponse = jest.fn()
            const { result } = renderHook(() => useThumbSurvey({ surveyId: 'test-survey', onResponse }), { wrapper })

            act(() => {
                result.current.respond('down')
            })

            expect(onResponse).toHaveBeenCalledWith('down')
        })
    })
})
