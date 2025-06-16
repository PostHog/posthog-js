import { WebExperiments } from '../web-experiments'
import { PostHog } from '../posthog-core'
import { PostHogConfig } from '../types'
import { PostHogPersistence } from '../posthog-persistence'
import { WebExperiment } from '../web-experiments-types'
import { RequestRouter } from '../utils/request-router'
import { ConsentManager } from '../consent'

describe('Web Experimentation', () => {
    let webExperiment: WebExperiments
    let posthog: PostHog
    let persistence: PostHogPersistence
    let experimentsResponse: { status?: number; experiments?: WebExperiment[] }

    const signupButtonWebExperimentWithFeatureFlag = {
        id: 3,
        name: 'Signup button test',
        feature_flag_key: 'signup-button-test',
        variants: {
            'variant-sign-up': {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Sign me up',
                    },
                ],
            },
            'variant-send-it': {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Send it',
                    },
                ],
            },
            'variant-css-transform': {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        css: 'font-size:40px',
                    },
                ],
            },
            'variant-inner-html-transform': {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: '<h1>hello world</h1>',
                    },
                ],
            },
            control: {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Sign up',
                    },
                ],
            },
        },
    } as unknown as WebExperiment

    const buttonWebExperimentWithUrlConditions = {
        id: 3,
        name: 'Signup button test',
        variants: {
            'variant-sign-up': {
                conditions: {
                    url: 'https://example.com/Signup',
                    urlMatchType: 'exact',
                },
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Sign me up',
                    },
                ],
            },
            'variant-send-it': {
                conditions: { url: 'regex-url', urlMatchType: 'regex' },
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Send it',
                    },
                ],
            },
            'variant-icontains': {
                conditions: { url: 'checkout', urlMatchType: 'icontains' },
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Sign up',
                    },
                ],
            },
            control: {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        html: 'Sign up',
                    },
                ],
            },
        },
    } as unknown as WebExperiment

    const simulateFeatureFlags: jest.Mock = jest.fn()

    beforeEach(() => {
        let cachedFlags = {}
        persistence = { props: {}, register: jest.fn() } as unknown as PostHogPersistence
        posthog = makePostHog({
            config: {
                disable_web_experiments: false,
                api_host: 'https://test.com',
                token: 'testtoken',
                autocapture: true,
                region: 'us-east-1',
            } as unknown as PostHogConfig,
            persistence: persistence,
            get_property: jest.fn(),
            capture: jest.fn(),
            _send_request: jest
                .fn()
                .mockImplementation(({ callback }) => callback({ statusCode: 200, json: experimentsResponse })),
            consent: { isOptedOut: () => true } as unknown as ConsentManager,
            onFeatureFlags: jest.fn(),
            getFeatureFlag: (key: string) => {
                return cachedFlags[key]
            },
        })

        simulateFeatureFlags.mockImplementation((flags) => {
            cachedFlags = flags
            webExperiment.onFeatureFlags(Object.keys(flags))
        })

        posthog.requestRouter = new RequestRouter(posthog)
        webExperiment = new WebExperiments(posthog)
    })

    function createTestDocument() {
        const elParent = document.createElement('span')
        elParent.innerHTML = 'original'
        document.querySelectorAll = function () {
            return [elParent] as unknown as NodeListOf<Element>
        }
        return elParent
    }

    function testUrlMatch(testLocation: string, expectedInnerHTML: string) {
        experimentsResponse = {
            experiments: [buttonWebExperimentWithUrlConditions],
        }
        const webExperiment = new WebExperiments(posthog)
        const elParent = createTestDocument()

        WebExperiments.getWindowLocation = () => {
            // eslint-disable-next-line compat/compat
            return new URL(testLocation) as unknown as Location
        }

        webExperiment.getWebExperimentsAndEvaluateDisplayLogic(false)
        expect(elParent.innerHTML).toEqual(expectedInnerHTML)
    }

    function assertElementChanged(variant: string, expectedProperty: string, value: string) {
        const elParent = createTestDocument()
        webExperiment = new WebExperiments(posthog)

        simulateFeatureFlags({
            'signup-button-test': variant,
        })

        switch (expectedProperty) {
            case 'css':
                expect(elParent.getAttribute('style')).toEqual(value)
                break
            case 'innerHTML':
                expect(elParent.innerHTML).toEqual(value)
                break
        }
    }

    describe('bot detection', () => {
        it('does not apply web experiment if viewer is a bot', () => {
            experimentsResponse = {
                experiments: [buttonWebExperimentWithUrlConditions],
            }
            const webExperiment = new WebExperiments(posthog)
            webExperiment._is_bot = () => true
            const elParent = createTestDocument()

            simulateFeatureFlags({
                'signup-button-test': 'variant-sign-up',
            })

            expect(elParent.innerHTML).toEqual('original')
        })
    })

    describe('url match conditions', () => {
        it('exact location match', () => {
            // Should match 'variant-sign-up' -> "Sign me up"
            const testLocation = 'https://example.com/Signup'
            const expectedInnerHTML = 'Sign me up'
            testUrlMatch(testLocation, expectedInnerHTML)
        })

        it('regex location match', () => {
            // Should match 'variant-send-it' -> "Send it"
            const testLocation = 'https://regex-url.com/test'
            const expectedInnerHTML = 'Send it'
            testUrlMatch(testLocation, expectedInnerHTML)
        })

        it('icontains location match', () => {
            // Should match 'variantIcontains' -> "Sign up"
            const testLocation = 'https://example.com/checkout'
            const expectedInnerHTML = 'Sign up'
            testUrlMatch(testLocation, expectedInnerHTML)
        })
    })

    describe('utm match conditions', () => {
        it('can disqualify on utm terms', () => {
            const buttonWebExperimentWithUTMConditions = buttonWebExperimentWithUrlConditions

            // Attach UTM conditions to the 'variant-sign-up' variant
            buttonWebExperimentWithUTMConditions.variants['variant-sign-up'].conditions = {
                utm: {
                    utm_campaign: 'marketing',
                    utm_medium: 'desktop',
                },
            }

            const testLocation = 'https://example.com/landing-page?utm_campaign=marketing&utm_medium=mobile'
            const expectedInnerHTML = 'original'
            testUrlMatch(testLocation, expectedInnerHTML)
        })
    })

    describe('with feature flags', () => {
        it('experiments are disabled by default', async () => {
            const expResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            const disabledPostHog = makePostHog({
                config: {
                    api_host: 'https://test.com',
                    token: 'testtoken',
                    autocapture: true,
                    region: 'us-east-1',
                    // no disable_web_experiments set to false here, so it’s implicitly enabled
                } as unknown as PostHogConfig,
                persistence: persistence,
                get_property: jest.fn(),
                _send_request: jest
                    .fn()
                    .mockImplementation(({ callback }) => callback({ statusCode: 200, json: expResponse })),
                consent: { isOptedOut: () => true } as unknown as ConsentManager,
                onFeatureFlags: jest.fn(),
            })

            posthog.requestRouter = new RequestRouter(disabledPostHog)
            webExperiment = new WebExperiments(disabledPostHog)
            assertElementChanged('control', 'innerHTML', 'original')
        })

        it('makes no modifications if control variant', () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            // control => do nothing
            assertElementChanged('control', 'innerHTML', 'original')
            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('can render previews based on URL params', () => {
            experimentsResponse = {
                experiments: [buttonWebExperimentWithUrlConditions],
            }

            const webExperiment = new WebExperiments(posthog)
            const elParent = createTestDocument()
            const original = WebExperiments.getWindowLocation

            WebExperiments.getWindowLocation = () => {
                // eslint-disable-next-line compat/compat
                return new URL(
                    'https://example.com/landing-page?__experiment_id=3&__experiment_variant=variant-sign-up'
                ) as unknown as Location
            }

            // This forces a preview of 'variant-sign-up', ignoring real flags.
            webExperiment.previewWebExperiment()

            WebExperiments.getWindowLocation = original
            expect(elParent.innerHTML).toEqual('Sign me up')
            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('can set text of a <span> element', async () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            // 'variant-sign-up' => "Sign me up"
            assertElementChanged('variant-sign-up', 'innerHTML', 'Sign me up')
            expect(posthog.capture).not.toHaveBeenCalled()
        })

        it('can set child element of a <span> element', async () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            // variantInnerHtmlTransform => <h1>hello world</h1>
            assertElementChanged('variant-inner-html-transform', 'innerHTML', '<h1>hello world</h1>')
        })

        it('can set css of a <span> element', async () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            // variantCssTransform => sets 'font-size:40px'
            assertElementChanged('variant-css-transform', 'css', 'font-size:40px')
        })
    })

    function makePostHog(ph: Partial<PostHog>): PostHog {
        return {
            get_distinct_id() {
                return 'distinctid'
            },
            ...ph,
        } as unknown as PostHog
    }
})
