import { PostHogFeatureFlags } from '../posthog-featureflags'
import { PostHog } from '../posthog-core'
import { PostHogConfig } from '../types'
import { assignableWindow } from '../utils/globals'

describe('Evaluation Tags/Contexts', () => {
    let posthog: PostHog
    let featureFlags: PostHogFeatureFlags
    let mockSendRequest: jest.Mock

    beforeEach(() => {
        // Create a mock PostHog instance
        posthog = {
            config: {} as PostHogConfig,
            persistence: {
                getDistinctId: jest.fn().mockReturnValue('test-distinct-id'),
                getInitialProps: jest.fn().mockReturnValue({}),
            },
            getProperty: jest.fn().mockReturnValue({}),
            getDistinctId: jest.fn().mockReturnValue('test-distinct-id'),
            getGroups: jest.fn().mockReturnValue({}),
            requestRouter: {
                endpointFor: jest.fn().mockReturnValue('/flags/?v=2'),
            },
            _send_request: jest.fn(),
            _shouldDisableFlags: jest.fn().mockReturnValue(false),
        } as any

        mockSendRequest = posthog._send_request as jest.Mock

        featureFlags = new PostHogFeatureFlags(posthog)
    })

    describe('_getValidEvaluationEnvironments', () => {
        it('should return empty array when no contexts configured', () => {
            posthog.config.evaluationContexts = undefined
            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual([])
        })

        it('should return empty array when contexts is empty', () => {
            posthog.config.evaluationContexts = []
            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual([])
        })

        it('should filter out invalid contexts', () => {
            posthog.config.evaluationContexts = [
                'production',
                '',
                'staging',
                null as any,
                'development',
                undefined as any,
                '   ', // whitespace only
            ] as readonly string[]

            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual(['production', 'staging', 'development'])
        })

        it('should handle readonly array of valid contexts', () => {
            const contexts: readonly string[] = ['production', 'staging', 'development']
            posthog.config.evaluationContexts = contexts

            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual(['production', 'staging', 'development'])
        })

        it('should support deprecated evaluation_environments field', () => {
            assignableWindow.POSTHOG_DEBUG = true
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
            posthog.config.evaluation_environments = ['production', 'staging']

            // Call multiple times
            ;(featureFlags as any)._getValidEvaluationEnvironments()
            ;(featureFlags as any)._getValidEvaluationEnvironments()

            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual(['production', 'staging'])

            // Warning should be logged only once
            expect(warnSpy).toHaveBeenCalledTimes(1)
            expect(warnSpy).toHaveBeenCalledWith(
                '[PostHog.js] [FeatureFlags]',
                'evaluation_environments is deprecated. Use evaluationContexts instead. evaluation_environments will be removed in a future version.'
            )

            warnSpy.mockRestore()
            assignableWindow.POSTHOG_DEBUG = false
        })

        it('should prioritize evaluation_contexts over evaluation_environments', () => {
            posthog.config.evaluationContexts = ['new-context']
            posthog.config.evaluation_environments = ['old-environment']
            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual(['new-context'])
        })
    })

    describe('_shouldIncludeEvaluationEnvironments', () => {
        it('should return false when no valid contexts', () => {
            posthog.config.evaluationContexts = ['', '   ']
            const result = (featureFlags as any)._shouldIncludeEvaluationEnvironments()
            expect(result).toBe(false)
        })

        it('should return true when valid contexts exist', () => {
            posthog.config.evaluationContexts = ['production']
            const result = (featureFlags as any)._shouldIncludeEvaluationEnvironments()
            expect(result).toBe(true)
        })
    })

    describe('_callFlagsEndpoint', () => {
        it('should include evaluation_contexts in request when configured', () => {
            posthog.config.evaluationContexts = ['production', 'experiment-A']
            ;(featureFlags as any)._callFlagsEndpoint()

            expect(mockSendRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        evaluation_contexts: ['production', 'experiment-A'],
                    }),
                })
            )
        })

        it('should not include evaluation_contexts when not configured', () => {
            posthog.config.evaluationContexts = undefined
            ;(featureFlags as any)._callFlagsEndpoint()

            expect(mockSendRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.not.objectContaining({
                        evaluation_contexts: expect.anything(),
                    }),
                })
            )
        })

        it('should not include evaluation_contexts when empty array', () => {
            posthog.config.evaluationContexts = []
            ;(featureFlags as any)._callFlagsEndpoint()

            expect(mockSendRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.not.objectContaining({
                        evaluation_contexts: expect.anything(),
                    }),
                })
            )
        })

        it('should filter out invalid contexts before sending', () => {
            posthog.config.evaluationContexts = ['production', '', null as any, 'staging']
            ;(featureFlags as any)._callFlagsEndpoint()

            expect(mockSendRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        evaluation_contexts: ['production', 'staging'],
                    }),
                })
            )
        })

        it('should support deprecated evaluation_environments field', () => {
            posthog.config.evaluation_environments = ['production', 'experiment-A']
            ;(featureFlags as any)._callFlagsEndpoint()

            expect(mockSendRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        evaluation_contexts: ['production', 'experiment-A'],
                    }),
                })
            )
        })
    })
})
