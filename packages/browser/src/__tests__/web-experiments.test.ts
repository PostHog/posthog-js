import type { Mock as VitestMock } from 'vitest'
import { WebExperiments } from '../web-experiments'
import { defaultConfig, PostHog } from '../posthog-core'
import { PostHogPersistence } from '../posthog-persistence'
import { WebExperiment } from '../web-experiments-types'
import { RequestRouter } from '../utils/request-router'
import { ConsentManager } from '../consent'
import { createMockPostHog, createMockConfig, createMockPersistence } from './helpers/posthog-instance'

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

    const simulateFeatureFlags: VitestMock = vi.fn()

    beforeEach(() => {
        let cachedFlags = {}
        experimentsResponse = { experiments: [] }
        persistence = createMockPersistence({ props: {}, register: vi.fn() })
        posthog = makePostHog({
            config: createMockConfig({
                disable_web_experiments: false,
                api_host: 'https://test.com',
                token: 'testtoken',
                autocapture: true,
            }),
            persistence: persistence,
            get_property: vi.fn(),
            capture: vi.fn(),
            _send_request: vi
                .fn()
                .mockImplementation(({ callback }) => callback({ statusCode: 200, json: experimentsResponse })),
            consent: { isOptedOut: () => true } as unknown as ConsentManager,
            onFeatureFlags: vi.fn(),
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

    afterEach(() => {
        vi.restoreAllMocks()
        document.body.innerHTML = ''
        window.history.replaceState({}, '', '/')
    })

    function createTestDocument() {
        const elParent = document.createElement('span')
        elParent.id = 'set-user-properties'
        elParent.innerHTML = 'original'
        document.body.appendChild(elParent)
        return elParent
    }

    function testUrlMatch(testLocation: string, expectedInnerHTML: string) {
        experimentsResponse = {
            experiments: [buttonWebExperimentWithUrlConditions],
        }
        const webExperiment = new WebExperiments(posthog)
        const elParent = createTestDocument()

        vi.spyOn(WebExperiments, 'getWindowLocation').mockReturnValue(new URL(testLocation) as unknown as Location)

        webExperiment.getWebExperimentsAndEvaluateDisplayLogic(false)
        expect(posthog._send_request).toHaveBeenLastCalledWith(
            expect.objectContaining({ method: 'GET', timestampMode: 'query' })
        )
        expect(elParent.innerHTML).toEqual(expectedInnerHTML)
    }

    function assertElementChanged(variant: string, expectedProperty: string, value: string) {
        const elParent = createTestDocument()

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
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            const isBot = vi.spyOn(webExperiment, '_is_bot').mockReturnValue(true)
            const elParent = createTestDocument()

            simulateFeatureFlags({
                'signup-button-test': 'variant-sign-up',
            })

            expect(elParent.innerHTML).toEqual('original')
            expect(posthog._send_request).not.toHaveBeenCalled()

            isBot.mockReturnValue(false)
            simulateFeatureFlags({ 'signup-button-test': 'variant-sign-up' })
            expect(elParent.innerHTML).toEqual('Sign me up')
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

        describe('get_current_url override', () => {
            it('matches against the overridden URL, not the raw browser URL', () => {
                experimentsResponse = { experiments: [buttonWebExperimentWithUrlConditions] }
                const webExperiment = new WebExperiments(posthog)
                const elParent = createTestDocument()

                // raw browser URL would not match the exact condition

                vi.spyOn(WebExperiments, 'getWindowLocation').mockReturnValue(
                    new URL('https://generated-host.skin/x') as unknown as Location
                )
                posthog.config.get_current_url = () => 'https://example.com/Signup'

                webExperiment.getWebExperimentsAndEvaluateDisplayLogic(false)
                expect(elParent.innerHTML).toEqual('Sign me up')
            })

            it('does not match when the override rewrites away from the matching URL', () => {
                experimentsResponse = { experiments: [buttonWebExperimentWithUrlConditions] }
                const webExperiment = new WebExperiments(posthog)
                const elParent = createTestDocument()

                vi.spyOn(WebExperiments, 'getWindowLocation').mockReturnValue(
                    new URL('https://example.com/Signup') as unknown as Location
                )
                posthog.config.get_current_url = () => 'https://generated-host.skin/x'

                webExperiment.getWebExperimentsAndEvaluateDisplayLogic(false)
                expect(elParent.innerHTML).toEqual('original')
            })
        })
    })

    describe('utm match conditions', () => {
        const utm = {
            utm_source: 'newsletter',
            utm_campaign: 'marketing',
            utm_medium: 'desktop',
            utm_term: 'signup',
        }

        beforeEach(() => {
            experimentsResponse = {
                experiments: [
                    {
                        ...buttonWebExperimentWithUrlConditions,
                        variants: {
                            'variant-sign-up': {
                                ...buttonWebExperimentWithUrlConditions.variants['variant-sign-up'],
                                conditions: { utm },
                            },
                        },
                    },
                ],
            }
        })

        it.each(['utm_source', 'utm_campaign', 'utm_medium', 'utm_term'])(
            'disqualifies when %s does not match',
            (key) => {
                const elParent = createTestDocument()
                const params = new URLSearchParams({ ...utm, [key]: 'mismatch' })
                window.history.replaceState({}, '', `/?${params}`)

                webExperiment.getWebExperimentsAndEvaluateDisplayLogic()

                expect(elParent.innerHTML).toEqual('original')
            }
        )

        it('applies the variant when all UTM conditions match', () => {
            const elParent = createTestDocument()
            window.history.replaceState({}, '', `/?${new URLSearchParams(utm)}`)

            webExperiment.getWebExperimentsAndEvaluateDisplayLogic()

            expect(elParent.innerHTML).toEqual('Sign me up')
        })
    })

    describe.each([false, true])('remote HTML with disable_external_dependency_loading=%s', (disabled) => {
        beforeEach(() => {
            posthog.config.disable_external_dependency_loading = disabled
        })

        function setRemoteTransform(html: string, css?: string) {
            experimentsResponse = JSON.parse(
                JSON.stringify({
                    experiments: [
                        {
                            ...signupButtonWebExperimentWithFeatureFlag,
                            variants: {
                                test: {
                                    variant_name: 'test',
                                    transforms: [{ selector: '#set-user-properties', html, css }],
                                },
                            },
                        },
                    ],
                })
            )
        }

        it.each([
            [
                'event handlers',
                '<img src="/missing" onerror="window.__experimentExecuted = true">',
                '<img src="/missing">',
            ],
            ['script tags', '<script>window.__experimentExecuted = true</script><b>Safe</b>', '<b>Safe</b>'],
            ['javascript links', '<a href="javascript:alert(1)">Link</a>', '<a>Link</a>'],
            ['encoded active URLs', '<a href="java&#x09;script:alert(1)">Link</a>', '<a>Link</a>'],
            ['data HTML links', '<a href="data:text/html,<script>alert(1)</script>">Link</a>', '<a>Link</a>'],
            [
                'form action URLs',
                '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">Go</button></form>',
                '<form><button>Go</button></form>',
            ],
            [
                'SVG handlers and URLs',
                '<svg onload="alert(1)"><a xlink:href="javascript:alert(1)"><text>Link</text></a></svg>',
                '<svg><a><text>Link</text></a></svg>',
            ],
            ['embedded documents', '<iframe srcdoc="<img src=x onerror=alert(1)>"></iframe><b>Safe</b>', '<b>Safe</b>'],
        ])('removes %s from JSON-supplied transforms', (_name, html, expected) => {
            setRemoteTransform(html)
            const element = createTestDocument()

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(posthog._send_request).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: 'https://test.com/api/web_experiments/?token=testtoken',
                    method: 'GET',
                })
            )
            expect(element.innerHTML).toEqual(expected)
        })

        it.each(['http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg'])(
            'does not transform existing script elements in namespace %s',
            (namespace) => {
                const script = document.createElementNS(namespace, 'script')
                script.id = 'set-user-properties'
                document.body.appendChild(script)
                setRemoteTransform('window.__experimentScriptExecuted = true', 'color:red')

                simulateFeatureFlags({ 'signup-button-test': 'test' })

                expect(posthog._send_request).toHaveBeenCalled()
                expect(script.innerHTML).toEqual('')
                expect(script.hasAttribute('style')).toBe(false)
            }
        )

        it('preserves safe markup, attributes, links and CSS transformations', () => {
            const html =
                '<h2 class="offer" style="color: blue">Hello <strong>world</strong></h2>' +
                '<a href="https://example.com/signup" title="Sign up">Join</a>' +
                '<img src="/offer.png" alt="Offer"><span data-offer="summer" aria-label="Details">Details</span>'
            setRemoteTransform(html, 'font-size:40px;color:red')
            const element = createTestDocument()

            simulateFeatureFlags({ 'signup-button-test': 'test' })

            expect(element.innerHTML).toEqual(html)
            expect(element.getAttribute('style')).toEqual('font-size:40px;color:red')
        })
    })

    describe('with feature flags', () => {
        it('experiments are disabled by default', () => {
            experimentsResponse = {
                experiments: [signupButtonWebExperimentWithFeatureFlag],
            }
            posthog.config = defaultConfig()
            const elParent = createTestDocument()

            simulateFeatureFlags({ 'signup-button-test': 'variant-sign-up' })

            expect(elParent.innerHTML).toEqual('original')
            expect(posthog._send_request).not.toHaveBeenCalled()

            posthog.config.disable_web_experiments = false
            simulateFeatureFlags({ 'signup-button-test': 'variant-sign-up' })
            expect(elParent.innerHTML).toEqual('Sign me up')
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
            vi.spyOn(WebExperiments, 'getWindowLocation').mockReturnValue(
                new URL(
                    'https://example.com/landing-page?__experiment_id=3&__experiment_variant=variant-sign-up'
                ) as unknown as Location
            )

            // This forces a preview of 'variant-sign-up', ignoring real flags.
            webExperiment.previewWebExperiment()

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
        return createMockPostHog({
            get_distinct_id() {
                return 'distinctid'
            },
            ...ph,
        })
    }
})
