import { PostHogFeatureFlags } from '../posthog-featureflags'
import { PostHog } from '../posthog-core'
import { PostHogConfig } from '../types'

describe('Evaluation Tags/Environments', () => {
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
        it('should return empty array when no environments configured', () => {
            posthog.config.evaluation_environments = undefined
            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual([])
        })

        it('should return empty array when environments is empty', () => {
            posthog.config.evaluation_environments = []
            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual([])
        })

        it('should filter out invalid environments', () => {
            posthog.config.evaluation_environments = [
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

        it('should handle readonly array of valid environments', () => {
            const environments: readonly string[] = ['production', 'staging', 'development']
            posthog.config.evaluation_environments = environments

            const result = (featureFlags as any)._getValidEvaluationEnvironments()
            expect(result).toEqual(['production', 'staging', 'development'])
        })
    })

    describe('_shouldIncludeEvaluationEnvironments', () => {
        it('should return false when no valid environments', () => {
            posthog.config.evaluation_environments = ['', '   ']
            const result = (featureFlags as any)._shouldIncludeEvaluationEnvironments()
            expect(result).toBe(false)
        })

        it('should return true when valid environments exist', () => {
            posthog.config.evaluation_environments = ['production']
            const result = (featureFlags as any)._shouldIncludeEvaluationEnvironments()
            expect(result).toBe(true)
        })
    })

    describe('_callFlagsEndpoint', () => {
        it('should include evaluation_environments in request when configured', () => {
            posthog.config.evaluation_environments = ['production', 'experiment-A']
            ;(featureFlags as any)._callFlagsEndpoint()

            expect(mockSendRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        evaluation_environments: ['production', 'experiment-A'],
                    }),
                })
            )
        })

        it('should not include evaluation_environments when not configured', () => {
            posthog.config.evaluation_environments = undefined
            ;(featureFlags as any)._callFlagsEndpoint()

            expect(mockSendRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.not.objectContaining({
                        evaluation_environments: expect.anything(),
                    }),
                })
            )
        })

        it('should not include evaluation_environments when empty array', () => {
            posthog.config.evaluation_environments = []
            ;(featureFlags as any)._callFlagsEndpoint()

            expect(mockSendRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.not.objectContaining({
                        evaluation_environments: expect.anything(),
                    }),
                })
            )
        })

        it('should filter out invalid environments before sending', () => {
            posthog.config.evaluation_environments = ['production', '', null as any, 'staging']
            ;(featureFlags as any)._callFlagsEndpoint()

            expect(mockSendRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        evaluation_environments: ['production', 'staging'],
                    }),
                })
            )
        })
    })
})
