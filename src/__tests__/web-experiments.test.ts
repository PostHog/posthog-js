import { WebExperiments } from '../web-experiments'
import { PostHog } from '../posthog-core'
import { DecideResponse, PostHogConfig } from '../types'
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
            'css-transform': {
                transforms: [
                    {
                        selector: '#set-user-properties',
                        css: 'font-size:40px',
                    },
                ],
            },
            'innerhtml-transform': {
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
            icontains: {
                conditions: { url: 'checkout', urlMatchType: 'icontains' },
                transforms: [
                    {
                        selector: '#set-user-properties',
                        text: 'Sign up',
                        html: 'Sign up',
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
            capture: jest.fn(),
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
        elParent.innerText = 'original'
        elParent.className = 'original'
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

    function assertElementChanged(variant: string, expectedProperty: string, value: string) {
        const elParent = createTestDocument()
        webExperiment = new WebExperiments(posthog)
        webExperiment.afterDecideResponse({
            featureFlags: {
                'signup-button-test': variant,
            },
        } as unknown as DecideResponse)

        switch (expectedProperty) {
            case 'css':
                expect(elParent.getAttribute('style')).toEqual(value)
                break

            case 'innerText':
                expect(elParent.innerText).toEqual(value)
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

            webExperiment.afterDecideResponse({
                featureFlags: {
                    'signup-button-test': 'Sign me up',
                },
            } as unknown as DecideResponse)
            expect(elParent.innerText).toEqual('original')
        })
    })

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
        it('can disqualify on utm terms', () => {
            const buttonWebExperimentWithUTMConditions = buttonWebExperimentWithUrlConditions
            buttonWebExperimentWithUTMConditions.variants['Signup'].conditions = {
                utm: {
                    utm_campaign: 'marketing',
                    utm_medium: 'desktop',
                },
            }
            const testLocation = 'https://example.com/landing-page?utm_campaign=marketing&utm_medium=mobile'
            const expectedText = 'original'
            testUrlMatch(testLocation, expectedText)
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
                } as unknown as PostHogConfig,
                persistence: persistence,
                get_property: jest.fn(),
                _send_request: jest
                    .fn()
                    .mockImplementation(({ callback }) => callback({ statusCode: 200, json: expResponse })),
                consent: { isOptedOut: () => true } as unknown as ConsentManager,
            })

            posthog.requestRouter = new RequestRouter(disabledPostHog)
            webExperiment = new WebExperiments(disabledPostHog)
            assertElementChanged('control', 'innerText', 'original')
        })

        it('can set text of Span Element', async () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }

            assertElementChanged('Signup', 'innerText', 'Sign me up')
            expect(posthog.capture).toHaveBeenCalledWith('$web_experiment_applied', {
                $web_experiment_document_url:
                    'https://example.com/landing-page?utm_campaign=marketing&utm_medium=mobile',
                $web_experiment_elements_modified: 1,
                $web_experiment_name: 'Signup button test',
                $web_experiment_variant: 'Signup',
            })
        })

        it('makes no modifications if control variant', () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            assertElementChanged('control', 'innerText', 'original')
            expect(posthog.capture).toHaveBeenCalledWith('$web_experiment_applied', {
                $web_experiment_document_url:
                    'https://example.com/landing-page?utm_campaign=marketing&utm_medium=mobile',
                $web_experiment_elements_modified: 0,
                $web_experiment_name: 'Signup button test',
                $web_experiment_variant: 'control',
            })
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
                    'https://example.com/landing-page?__experiment_id=3&__experiment_variant=Signup'
                ) as unknown as Location
            }

            webExperiment.previewWebExperiment()

            WebExperiments.getWindowLocation = original
            expect(elParent.innerText).toEqual('Sign me up')
            expect(posthog.capture).toHaveBeenCalledWith('$web_experiment_applied', {
                $web_experiment_document_url:
                    'https://example.com/landing-page?__experiment_id=3&__experiment_variant=Signup',
                $web_experiment_elements_modified: 1,
                $web_experiment_name: 'Signup button test',
                $web_experiment_variant: 'Signup',
                $web_experiment_preview: true,
            })
        })

        it('can set css of Span Element', async () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }

            assertElementChanged('css-transform', 'css', 'font-size:40px')
        })

        it('can set innerHTML of Span Element', async () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            assertElementChanged('innerhtml-transform', 'innerHTML', '<h1>hello world</h1>')
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
