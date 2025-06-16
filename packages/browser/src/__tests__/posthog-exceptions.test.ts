import { ERROR_TRACKING_SUPPRESSION_RULES } from '../constants'
import { PostHog } from '../posthog-core'
import { PostHogExceptions } from '../posthog-exceptions'
import { PostHogPersistence } from '../posthog-persistence'
import {
    FlagsResponse,
    ErrorTrackingSuppressionRule,
    ErrorTrackingSuppressionRuleValue,
    PostHogConfig,
    Property,
} from '../types'

function createSuppressionRule(
    type: 'AND' | 'OR' = 'OR',
    values: ErrorTrackingSuppressionRuleValue[] = [
        {
            key: '$exception_types',
            value: ['TypeError', 'ReactError'],
            operator: 'exact',
            type: 'error_tracking_issue_property',
        },
        {
            key: '$exception_values',
            value: 'ReactMinified',
            operator: 'icontains',
            type: 'error_tracking_issue_property',
        },
    ]
): ErrorTrackingSuppressionRule {
    return { type, values }
}

describe('PostHogExceptions', () => {
    const captureMock = jest.fn()
    let posthog: PostHog
    let exceptions: PostHogExceptions
    let config: PostHogConfig

    beforeEach(() => {
        config = { persistence: 'memory' } as unknown as PostHogConfig

        const postHogPersistence = new PostHogPersistence(config)
        postHogPersistence.clear()

        // TODO: we really need to make this a real posthog instance :cry:
        posthog = {
            get_property: (property_key: string): Property | undefined => {
                return postHogPersistence?.props[property_key]
            },
            config: config,
            capture: captureMock,
            persistence: postHogPersistence,
        } as Partial<PostHog> as PostHog

        // defaults
        posthog.persistence?.register({
            [ERROR_TRACKING_SUPPRESSION_RULES]: [],
        })

        exceptions = new PostHogExceptions(posthog)
    })

    afterEach(() => {
        captureMock.mockClear()
    })

    describe('onRemoteConfig', () => {
        it('persists the suppression rules', () => {
            const suppressionRule = createSuppressionRule()
            const flagsResponse: Partial<FlagsResponse> = { errorTracking: { suppressionRules: [suppressionRule] } }
            exceptions.onRemoteConfig(flagsResponse as FlagsResponse)
            expect(exceptions['_suppressionRules']).toEqual([suppressionRule])
        })
    })

    describe('sendExceptionEvent', () => {
        it('captures the event when no suppression rules are provided', () => {
            exceptions.sendExceptionEvent({ custom_property: true })
            expect(captureMock).toBeCalledWith('$exception', { custom_property: true }, expect.anything())
        })

        test.each([
            ['TypeError', 'This is a type error'],
            ['GenericError', 'This is a message that contains a ReactMinified error'],
        ])('drops the event if a suppression rule matches', (type, value) => {
            const suppressionRule = createSuppressionRule('OR')
            exceptions.onRemoteConfig({ errorTracking: { suppressionRules: [suppressionRule] } } as FlagsResponse)
            exceptions.sendExceptionEvent({ $exception_list: [{ type, value }] })
            expect(captureMock).not.toBeCalled()
        })

        it('captures an exception if no $exception_list property exists', () => {
            const suppressionRule = createSuppressionRule('AND')
            exceptions.onRemoteConfig({ errorTracking: { suppressionRules: [suppressionRule] } } as FlagsResponse)
            exceptions.sendExceptionEvent({ custom_property: true })
            expect(captureMock).toBeCalled()
        })

        it('captures an exception if all rule conditions do not match', () => {
            const suppressionRule = createSuppressionRule('AND')
            exceptions.onRemoteConfig({ errorTracking: { suppressionRules: [suppressionRule] } } as FlagsResponse)
            exceptions.sendExceptionEvent({ $exception_list: [{ type: 'TypeError', value: 'This is a type error' }] })
            expect(captureMock).toBeCalled()
        })

        it('captures an exception if there are no targets on the rule', () => {
            const suppressionRule = createSuppressionRule('OR', [
                {
                    key: '$exception_types',
                    value: [],
                    operator: 'exact',
                    type: 'error_tracking_issue_property',
                },
            ])
            exceptions.onRemoteConfig({ errorTracking: { suppressionRules: [suppressionRule] } } as FlagsResponse)
            exceptions.sendExceptionEvent({ $exception_list: [{ type: 'TypeError', value: 'This is a type error' }] })
            expect(captureMock).toBeCalled()
        })
    })
})
