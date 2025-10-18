import { ERROR_TRACKING_SUPPRESSION_RULES } from '../constants'
import { defaultConfig, PostHog } from '../posthog-core'
import { PostHogExceptions } from '../posthog-exceptions'
import { PostHogPersistence } from '../posthog-persistence'
import {
    ErrorTrackingSuppressionRule,
    ErrorTrackingSuppressionRuleValue,
    PostHogConfig,
    Property,
    RemoteConfig,
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
        config = { ...defaultConfig(), persistence: 'memory' }

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
            const remoteResponse: Partial<RemoteConfig> = { errorTracking: { suppressionRules: [suppressionRule] } }
            exceptions.onRemoteConfig(remoteResponse as RemoteConfig)
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
            exceptions.onRemoteConfig({ errorTracking: { suppressionRules: [suppressionRule] } } as RemoteConfig)
            exceptions.sendExceptionEvent({ $exception_list: [{ type, value }] })
            expect(captureMock).not.toBeCalled()
        })

        it('captures an exception if no $exception_list property exists', () => {
            const suppressionRule = createSuppressionRule('AND')
            exceptions.onRemoteConfig({ errorTracking: { suppressionRules: [suppressionRule] } } as RemoteConfig)
            exceptions.sendExceptionEvent({ custom_property: true })
            expect(captureMock).toBeCalled()
        })

        it('captures an exception if all rule conditions do not match', () => {
            const suppressionRule = createSuppressionRule('AND')
            exceptions.onRemoteConfig({ errorTracking: { suppressionRules: [suppressionRule] } } as RemoteConfig)
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
            exceptions.onRemoteConfig({ errorTracking: { suppressionRules: [suppressionRule] } } as RemoteConfig)
            exceptions.sendExceptionEvent({ $exception_list: [{ type: 'TypeError', value: 'This is a type error' }] })
            expect(captureMock).toBeCalled()
        })

        describe('Extension exceptions', () => {
            it('does not capture exceptions with frames from extensions by default', () => {
                const frame = { filename: 'chrome-extension://', platform: 'javascript:web' }
                const exception = { stacktrace: { frames: [frame], type: 'raw' } }
                exceptions.sendExceptionEvent({ $exception_list: [exception] })
                expect(captureMock).not.toBeCalledWith(
                    '$exception',
                    { $exception_list: [exception] },
                    expect.anything()
                )
            })

            it('captures extension exceptions when enabled', () => {
                exceptions.onRemoteConfig({ errorTracking: { captureExtensionExceptions: true } } as RemoteConfig)
                const frame = { filename: 'chrome-extension://', platform: 'javascript:web' }
                const exception = { stacktrace: { frames: [frame], type: 'raw' } }
                exceptions.sendExceptionEvent({ $exception_list: [exception] })
                expect(captureMock).toBeCalledWith('$exception', { $exception_list: [exception] }, expect.anything())
            })
        })

        describe('PostHog SDK exceptions', () => {
            const inAppFrame = {
                filename: '../src/in-app-file.js',
                platform: 'javascript:web',
            }
            const posthogFrame = {
                filename: 'https://internal-t.posthog.com/static/array.js',
                platform: 'javascript:web',
            }

            it('does not capture exceptions thrown by the PostHog SDK', () => {
                const exception = { stacktrace: { frames: [inAppFrame, posthogFrame], type: 'raw' } }
                exceptions.sendExceptionEvent({ $exception_list: [exception] })
                expect(captureMock).not.toBeCalledWith(
                    '$exception',
                    { $exception_list: [exception] },
                    expect.anything()
                )
            })

            it('captures the exception if a frame from the PostHog SDK is not the kaboom frame', () => {
                const exception = { stacktrace: { frames: [posthogFrame, inAppFrame], type: 'raw' } }
                exceptions.sendExceptionEvent({ $exception_list: [exception] })
                expect(captureMock).toBeCalledWith('$exception', { $exception_list: [exception] }, expect.anything())
            })

            it('captures exceptions thrown within the PostHog SDK when enabled', () => {
                config.error_tracking.__capturePostHogExceptions = true
                const exception = { stacktrace: { frames: [inAppFrame, posthogFrame], type: 'raw' } }
                exceptions.sendExceptionEvent({ $exception_list: [exception] })
                expect(captureMock).toBeCalledWith('$exception', { $exception_list: [exception] }, expect.anything())
            })
        })
    })
})
