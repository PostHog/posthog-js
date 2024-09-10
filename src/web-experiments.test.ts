import { WebExperiments } from './web-experiments'
import { PostHog } from './posthog-core'
import { DecideResponse, PostHogConfig } from './types'
import { PostHogPersistence } from './posthog-persistence'
import { WebExperiment } from './web-experiments-types'
import { RequestRouter } from './utils/request-router'
import { ConsentManager } from './consent'

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
            Signup: {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        text: 'Sign me up',
                        html: 'Sign me up',
                    },
                ],
            },
            'Send-it': {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        text: 'Send it',
                        html: 'Send it',
                    },
                ],
            },
            control: {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        text: 'Sign up',
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
            Signup: {
                conditions: {
                    url: 'https://example.com/Signup',
                    urlMatchType: 'exact',
                },
                transforms: [
                    {
                        selector: '#set-user-properties',
                        text: 'Sign me up',
                        html: 'Sign me up',
                    },
                ],
            },
            'Send-it': {
                conditions: { url: 'regex-url', urlMatchType: 'regex' },
                transforms: [
                    {
                        selector: '#set-user-properties',
                        text: 'Send it',
                        html: 'Send it',
                    },
                ],
            },
            control: {
                conditions: { url: 'checkout', urlMatchType: 'icontains' },
                transforms: [
                    {
                        selector: '#set-user-properties',
                        text: 'Sign up',
                        html: 'Sign up',
                    },
                ],
            },
        },
    } as unknown as WebExperiment

    beforeEach(() => {
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
            _send_request: jest
                .fn()
                .mockImplementation(({ callback }) => callback({ statusCode: 200, json: experimentsResponse })),
            consent: { isOptedOut: () => true } as unknown as ConsentManager,
        })

        posthog.requestRouter = new RequestRouter(posthog)
        webExperiment = new WebExperiments(posthog)
    })

    function createTestDocument() {
        // eslint-disable-next-line no-restricted-globals
        const elTarget = document.createElement('img')
        elTarget.id = 'primary_button'
        // eslint-disable-next-line no-restricted-globals
        const elParent = document.createElement('span')
        elParent.innerText = 'unassigned'
        elParent.appendChild(elTarget)
        // eslint-disable-next-line no-restricted-globals
        document.querySelectorAll = function () {
            return [elParent] as unknown as NodeListOf<Element>
        }

        return elParent
    }

    function testUrlMatch(testLocation: string, expectedText: string) {
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
        expect(elParent.innerText).toEqual(expectedText)
    }
    function assertSpanTextChanged(expectedText: string) {
        const elParent = createTestDocument()
        webExperiment = new WebExperiments(posthog)
        webExperiment.afterDecideResponse({
            featureFlags: {
                'signup-button-test': 'control',
            },
        } as unknown as DecideResponse)

        expect(elParent.innerText).toEqual(expectedText)
    }

    describe('url match conditions', () => {
        it('exact location match', () => {
            const testLocation = 'https://example.com/Signup'
            const expectedText = 'Sign me up'
            testUrlMatch(testLocation, expectedText)
        })

        it('regex location match', () => {
            const testLocation = 'https://regex-url.com/test'
            const expectedText = 'Send it'
            testUrlMatch(testLocation, expectedText)
        })

        it('icontains location match', () => {
            const testLocation = 'https://example.com/checkout'
            const expectedText = 'Sign up'
            testUrlMatch(testLocation, expectedText)
        })
    })

    describe('utm match conditions', () => {
        it('can match on utm terms', () => {
            const buttonWebExperimentWithUTMConditions = buttonWebExperimentWithUrlConditions
            buttonWebExperimentWithUTMConditions.variants['Signup'].conditions = {
                utm: {
                    utm_campaign: 'marketing',
                    utm_medium: 'mobile',
                },
            }
            const testLocation = 'https://example.com/landing-page?utm_campaign=marketing&utm_medium=mobile'
            const expectedText = 'Sign me up'
            testUrlMatch(testLocation, expectedText)
        })

        it('can disqualify on utm terms', () => {
            const buttonWebExperimentWithUTMConditions = buttonWebExperimentWithUrlConditions
            buttonWebExperimentWithUTMConditions.variants['Signup'].conditions = {
                utm: {
                    utm_campaign: 'marketing',
                    utm_medium: 'desktop',
                },
            }
            const testLocation = 'https://example.com/landing-page?utm_campaign=marketing&utm_medium=mobile'
            const expectedText = 'unassigned'
            testUrlMatch(testLocation, expectedText)
        })
    })

    describe('with feature flags', () => {
        it('can set text of Span Element', () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            assertSpanTextChanged('Sign up')
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
