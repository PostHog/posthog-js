import { PostHogFeatureFlags } from '../posthog-featureflags'
import { PostHog } from '../posthog-core'
import { PostHogConfig } from '../types'

describe('Evaluation Tags/Contexts', () => {
    let posthog: PostHog
    let featureFlags: PostHogFeatureFlags
    let mockSendRequest: jest.Mock

    beforeEach(() => {
        // Create a mock PostHog instance
        posthog = {
            config: {} as PostHogConfig,
            persistence: {
                get_distinct_id: jest.fn().mockReturnValue('test-distinct-id'),
                get_initial_props: jest.fn().mockReturnValue({}),
            },
            get_property: jest.fn().mockReturnValue({}),
            get_distinct_id: jest.fn().mockReturnValue('test-distinct-id'),
            getGroups: jest.fn().mockReturnValue({}),
            requestRouter: {
                endpointFor: jest.fn().mockReturnValue('/flags/?v=2&config=true'),
            },
            _send_request: jest.fn(),
            _shouldDisableFlags: jest.fn().mockReturnValue(false),
        } as any

        mockSendRequest = posthog._send_request as jest.Mock

        featureFlags = new PostHogFeatureFlags(posthog)
    })

    describe('_getValidEvaluationEnvironments', () => {
        it('should return empty array when no contexts configured', () => {
            posthog.config.evaluation_contexts = undefined
            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual([])
        })

        it('should return empty array when contexts is empty', () => {
            posthog.config.evaluation_contexts = []
            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual([])
        })

        it('should filter out invalid contexts', () => {
            posthog.config.evaluation_contexts = [
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
            posthog.config.evaluation_contexts = contexts

            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual(['production', 'staging', 'development'])
        })

        it('should support deprecated evaluation_environments field', () => {
            posthog.config.evaluation_environments = ['production', 'staging']
            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual(['production', 'staging'])
        })

        it('should prioritize evaluation_contexts over evaluation_environments', () => {
            posthog.config.evaluation_contexts = ['new-context']
            posthog.config.evaluation_environments = ['old-environment']
            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual(['new-context'])
        })
    })

    describe('_shouldIncludeEvaluationEnvironments', () => {
        it('should return false when no valid contexts', () => {
            posthog.config.evaluation_contexts = ['', '   ']
            const result = (featureFlags as any)._shouldIncludeEvaluationEnvironments()
            expect(result).toBe(false)
        })

        it('should return true when valid contexts exist', () => {
            posthog.config.evaluation_contexts = ['production']
            const result = (featureFlags as any)._shouldIncludeEvaluationEnvironments()
            expect(result).toBe(true)
        })
    })

    describe('_callFlagsEndpoint', () => {
        it('should include evaluation_contexts in request when configured', () => {
            posthog.config.evaluation_contexts = ['production', 'experiment-A']
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
            posthog.config.evaluation_contexts = undefined
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
            posthog.config.evaluation_contexts = []
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
            posthog.config.evaluation_contexts = ['production', '', null as any, 'staging']
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
